// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AcknowledgeRecoveryKey,
  AuthenticateNativeIdentity,
  ForgetRememberedBond,
  LogoutNativeIdentity,
  ReadNativeIdentityContext,
  ReadProviderIdentity,
  ReadRuntimeReadiness,
  RegisterNativeIdentity,
  RegisterProviderIdentity,
  ResolvePubDress,
  type CoreRuntimePort,
  type IdentityAccessPort,
  type PubDressSelection,
} from "@nilx-one/application";
import {
  hasAuthenticatedHostSession,
  type HostPort,
  type HostSnapshot,
} from "@nilx-one/host-contract";
import type { MapRenderer } from "@nilx-one/map-contract";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useMatchRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import "./product.css";
import "./features/identity/identity-field-feedback.css";
import { FailureNoticeProvider } from "./features/failures/failure-toast-region";
import { IdentityFoundationView } from "./features/identity/identity-foundation-view";
import {
  createIdentityFoundationViewModel,
  createNativeIdentityViewState,
  createProviderIdentityViewState,
  createPubDressStatusViewState,
} from "./features/identity/identity-foundation-view-model";
import { normalizePubDressCredentialInput } from "./features/identity/pub-dress-credential-input";
import { AuthenticatedMapHomeView } from "./features/map/authenticated-map-home-view";
import { MapFoundationView } from "./features/map/map-foundation-view";
import {
  IDENTITY_ROUTE,
  SETTINGS_ROUTE,
  WORLD_ROUTE,
  type ShellRoute,
  type ShellSection,
} from "./shell/routes";
import { ToastViewportProvider } from "./shell/toast-viewport";

export {
  usePublishFailure,
  type PublishFailure,
  type PublishFailureOptions,
} from "./features/failures/failure-toast-region";

export interface ProductAppDependencies {
  core: CoreRuntimePort;
  host: HostPort;
  identity: IdentityAccessPort;
  mapRenderer: MapRenderer;
}

export interface ProductAppProps extends ProductAppDependencies {
  routerBasepath?: string;
}

interface ProductRouterContext {
  dependencies: ProductAppDependencies;
}

interface PendingAutofillCredential {
  password: string;
  selection: PubDressSelection;
}

function useHostSnapshot(host: HostPort): HostSnapshot {
  const [snapshot, setSnapshot] = useState(() => host.getSnapshot());
  useEffect(() => host.subscribe(setSnapshot), [host]);
  return snapshot;
}

const PUB_DRESS_RESOLUTION_DELAY_MS = 1_000;

function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `0x1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function validNativePassword(password: string): boolean {
  const normalized = password.normalize("NFC");
  const length = [...normalized].length;
  return (
    length >= 8 &&
    length <= 128 &&
    normalized.trim() === normalized &&
    !/[\p{Cc}\u2028\u2029]/u.test(normalized)
  );
}

/** The root only selects between the persistent product foundation and diagnostics. */
function RootRoute() {
  return <Outlet />;
}

const rootRoute = createRootRouteWithContext<ProductRouterContext>()({
  component: RootRoute,
});

/**
 * `/`, `/identity`, and `/settings` are presentation states of one foundation.
 * Keeping their shared owner on this pathless route prevents route selection
 * from becoming accidental ownership of the authenticated world lifecycle.
 */
function FoundationRouteView() {
  const { dependencies } = foundationRoute.useRouteContext();
  const matchRoute = useMatchRoute();
  const section: ShellSection = matchRoute({ to: SETTINGS_ROUTE })
    ? "settings"
    : matchRoute({ to: IDENTITY_ROUTE })
      ? "identity"
      : "world";

  return (
    <>
      <FoundationSurface dependencies={dependencies} section={section} />
      <Outlet />
    </>
  );
}

function ShellSectionRoute() {
  return null;
}

const foundationRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "foundation",
  component: FoundationRouteView,
});

const worldRoute = createRoute({
  getParentRoute: () => foundationRoute,
  path: WORLD_ROUTE,
  component: ShellSectionRoute,
});

const identityRoute = createRoute({
  getParentRoute: () => foundationRoute,
  path: IDENTITY_ROUTE,
  component: ShellSectionRoute,
});

const settingsRoute = createRoute({
  getParentRoute: () => foundationRoute,
  path: SETTINGS_ROUTE,
  component: ShellSectionRoute,
});

// Renderer diagnostics. Never navigation: the map is the world, not a tab.
const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  component: MapRoute,
});

function MapRoute() {
  const { dependencies } = mapRoute.useRouteContext();
  return <MapFoundationView renderer={dependencies.mapRenderer} />;
}

interface FoundationSurfaceProps {
  readonly dependencies: ProductAppDependencies;
  readonly section: ShellSection;
}

function FoundationSurface({ dependencies, section }: FoundationSurfaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const host = useHostSnapshot(dependencies.host);
  const browserHost = host.kind === "browser";
  const [selection, setSelection] = useState<PubDressSelection>({
    discriminator: "0",
    slug: "",
  });
  const [password, setPassword] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [resolutionSelection, setResolutionSelection] = useState(selection);
  const [resolutionArmed, setResolutionArmed] = useState(false);
  const [useRememberedHint, setUseRememberedHint] = useState(true);
  const pendingAutofillCredential = useRef<
    PendingAutofillCredential | undefined
  >(undefined);

  const readinessQuery = useQuery({
    queryKey: ["core-runtime-readiness"],
    queryFn: () => new ReadRuntimeReadiness(dependencies.core).execute(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const nativeContextQuery = useQuery({
    queryKey: ["native-identity-context"],
    queryFn: () =>
      new ReadNativeIdentityContext(dependencies.identity).execute(),
    enabled: browserHost,
    retry: false,
    staleTime: 0,
  });
  const providerIdentityQuery = useQuery({
    queryKey: ["provider-identity", host.kind],
    queryFn: () => new ReadProviderIdentity(dependencies.identity).execute(),
    enabled: !browserHost && hasAuthenticatedHostSession(host),
    retry: false,
  });

  const nativeCanResolve =
    nativeContextQuery.data?.kind === "anonymous" ||
    (nativeContextQuery.data?.kind === "remembered" && !useRememberedHint);
  const providerCanResolve =
    providerIdentityQuery.data?.kind === "not-registered";
  const canResolve = browserHost ? nativeCanResolve : providerCanResolve;
  const selectionMatchesResolution =
    selection.discriminator === resolutionSelection.discriminator &&
    selection.slug === resolutionSelection.slug;
  const resolutionSlugLength = [...resolutionSelection.slug].length;
  const resolutionEnabled =
    resolutionArmed &&
    canResolve &&
    resolutionSlugLength >= 2 &&
    resolutionSlugLength <= 32;
  const resolutionQuery = useQuery({
    queryKey: [
      "pub-dress-resolution",
      resolutionSelection.discriminator,
      resolutionSelection.slug,
    ],
    queryFn: () =>
      new ResolvePubDress(dependencies.identity).execute(resolutionSelection),
    enabled: resolutionEnabled,
    retry: false,
    staleTime: 0,
  });
  const status = createPubDressStatusViewState(
    selection,
    resolutionArmed && selectionMatchesResolution && resolutionQuery.isFetching,
    resolutionArmed && selectionMatchesResolution
      ? resolutionQuery.data
      : undefined,
  );

  useEffect(() => {
    const slugLength = [...selection.slug].length;
    if (!canResolve || slugLength < 2 || slugLength > 32) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setResolutionSelection(selection);
      setResolutionArmed(true);
    }, PUB_DRESS_RESOLUTION_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [canResolve, selection]);

  const nativeRegistration = useMutation({
    mutationFn: (input: { pubDress: string; password: string }) =>
      new RegisterNativeIdentity(dependencies.identity).execute(
        input.pubDress,
        input.password,
        idempotencyKey,
      ),
    onSuccess: (result) => {
      if (result.kind === "rejected" && result.reason === "unavailable") {
        void resolutionQuery.refetch();
      }
    },
  });
  const nativeAuthentication = useMutation({
    mutationFn: (input: { pubDress: string; password: string }) =>
      new AuthenticateNativeIdentity(dependencies.identity).execute(
        input.pubDress,
        input.password,
      ),
  });
  const recoveryAcknowledgement = useMutation({
    mutationFn: (challenge: string) =>
      new AcknowledgeRecoveryKey(dependencies.identity).execute(challenge),
    onSuccess: (result) => {
      if (result.kind === "authenticated") {
        void queryClient.invalidateQueries({
          queryKey: ["native-identity-context"],
        });
      }
    },
  });
  const providerRegistration = useMutation({
    mutationFn: (selection: PubDressSelection) =>
      new RegisterProviderIdentity(dependencies.identity).execute(selection),
    onSuccess: (result) => {
      if (result.kind === "rejected" && result.reason === "unavailable") {
        void resolutionQuery.refetch();
      }
    },
  });
  const forgetRemembered = useMutation({
    mutationFn: () => new ForgetRememberedBond(dependencies.identity).execute(),
    onSuccess: (result) => {
      if (result.kind !== "completed") {
        return;
      }
      queryClient.setQueryData(["native-identity-context"], {
        kind: "anonymous",
      });
      nativeRegistration.reset();
      nativeAuthentication.reset();
      recoveryAcknowledgement.reset();
      setSelection({ discriminator: "0", slug: "" });
      setPassword("");
      setIdempotencyKey(newIdempotencyKey());
      setUseRememberedHint(false);
      pendingAutofillCredential.current = undefined;
    },
  });
  const logout = useMutation({
    mutationFn: () => new LogoutNativeIdentity(dependencies.identity).execute(),
    onSuccess: async (result) => {
      if (result.kind !== "completed") {
        return;
      }
      nativeRegistration.reset();
      nativeAuthentication.reset();
      recoveryAcknowledgement.reset();
      setUseRememberedHint(true);
      pendingAutofillCredential.current = undefined;
      await queryClient.invalidateQueries({
        queryKey: ["native-identity-context"],
      });
    },
  });

  const nativePending =
    nativeRegistration.isPending ||
    nativeAuthentication.isPending ||
    recoveryAcknowledgement.isPending ||
    forgetRemembered.isPending ||
    logout.isPending;
  const latestAuthentication =
    recoveryAcknowledgement.data ?? nativeAuthentication.data;
  const identityState = browserHost
    ? createNativeIdentityViewState(
        nativeContextQuery.data?.kind === "remembered" && !useRememberedHint
          ? { kind: "anonymous" }
          : nativeContextQuery.data,
        status,
        nativeRegistration.data,
        latestAuthentication,
        nativePending,
      )
    : createProviderIdentityViewState(
        host,
        providerIdentityQuery.data,
        providerRegistration.data,
        status,
        providerRegistration.isPending,
      );
  const viewModel = createIdentityFoundationViewModel(
    host,
    readinessQuery.data,
    identityState,
  );

  useEffect(() => {
    document.documentElement.dataset.hostTheme = host.theme;
    document.documentElement.dataset.host = host.kind;
  }, [host.kind, host.theme]);

  function changeSelection(next: PubDressSelection): void {
    if (nativeContextQuery.data?.kind === "remembered") {
      setUseRememberedHint(false);
    }
    setResolutionArmed(false);
    setSelection(normalizePubDressCredentialInput(next, selection));
    setPassword("");
    pendingAutofillCredential.current = undefined;
    setIdempotencyKey(newIdempotencyKey());
    nativeRegistration.reset();
    nativeAuthentication.reset();
  }

  function applyAutofilledCredential(
    nextSelection: PubDressSelection,
    nextPassword: string,
  ): void {
    const normalizedSelection = normalizePubDressCredentialInput(
      nextSelection,
      selection,
    );
    setUseRememberedHint(false);
    setSelection(normalizedSelection);
    setPassword(nextPassword);
    setIdempotencyKey(newIdempotencyKey());
    setResolutionSelection(normalizedSelection);
    setResolutionArmed(true);
    pendingAutofillCredential.current = {
      password: nextPassword,
      selection: normalizedSelection,
    };
    nativeRegistration.reset();
    nativeAuthentication.reset();
    recoveryAcknowledgement.reset();
  }

  function resolvePubDressNow(): void {
    const slugLength = [...selection.slug].length;
    if (!canResolve || slugLength < 2 || slugLength > 32) {
      return;
    }
    if (selectionMatchesResolution && resolutionArmed) {
      void resolutionQuery.refetch();
      return;
    }
    setResolutionSelection(selection);
    setResolutionArmed(true);
  }

  function resolvedNativePubDress(): string | undefined {
    if (identityState.kind !== "form") {
      return undefined;
    }
    if (identityState.mode === "remembered") {
      return identityState.rememberedPubDress;
    }
    if (!selectionMatchesResolution) {
      return undefined;
    }
    if (
      identityState.mode === "sign-in" &&
      resolutionQuery.data?.kind === "registered"
    ) {
      return resolutionQuery.data.pubDress;
    }
    if (
      identityState.mode === "register" &&
      resolutionQuery.data?.kind === "available"
    ) {
      return resolutionQuery.data.pubDress;
    }
    return undefined;
  }

  function submitIdentity(): void {
    if (identityState.kind !== "form" || identityState.busy) {
      return;
    }
    switch (identityState.mode) {
      case "sign-in":
      case "remembered": {
        const pubDress = resolvedNativePubDress();
        if (pubDress === undefined) {
          return;
        }
        nativeAuthentication.reset();
        recoveryAcknowledgement.reset();
        nativeAuthentication.mutate({ pubDress, password });
        break;
      }
      case "register": {
        const pubDress = resolvedNativePubDress();
        if (pubDress === undefined) {
          return;
        }
        nativeRegistration.mutate({ pubDress, password });
        break;
      }
      case "provider-register":
        providerRegistration.mutate(selection);
        break;
      case "initial":
      case "resolving":
        break;
    }
  }

  useEffect(() => {
    if (
      pendingAutofillCredential.current === undefined ||
      nativePending ||
      resolutionQuery.isFetching ||
      !validNativePassword(pendingAutofillCredential.current.password) ||
      pendingAutofillCredential.current.selection.discriminator !==
        resolutionSelection.discriminator ||
      pendingAutofillCredential.current.selection.slug !==
        resolutionSelection.slug ||
      !selectionMatchesResolution
    ) {
      return;
    }

    const credential = pendingAutofillCredential.current;
    const resolution = resolutionQuery.data;
    if (resolution?.kind === "registered") {
      pendingAutofillCredential.current = undefined;
      nativeAuthentication.reset();
      recoveryAcknowledgement.reset();
      nativeAuthentication.mutate({
        pubDress: resolution.pubDress,
        password: credential.password,
      });
      return;
    }
    if (resolution?.kind === "available") {
      pendingAutofillCredential.current = undefined;
      nativeRegistration.reset();
      nativeRegistration.mutate({
        pubDress: resolution.pubDress,
        password: credential.password,
      });
      return;
    }
    if (
      resolution?.kind === "rejected" ||
      resolution?.kind === "rate-limited" ||
      resolution?.kind === "service-unavailable"
    ) {
      pendingAutofillCredential.current = undefined;
    }
  }, [
    nativeAuthentication,
    nativePending,
    nativeRegistration,
    password,
    recoveryAcknowledgement,
    resolutionQuery.data,
    resolutionQuery.isFetching,
    resolutionSelection.discriminator,
    resolutionSelection.slug,
    selectionMatchesResolution,
  ]);

  if (viewModel.identity.kind === "authenticated") {
    return (
      <AuthenticatedMapHomeView
        hostLabel={viewModel.hostLabel}
        pubDress={viewModel.identity.pubDress}
        renderer={dependencies.mapRenderer}
        runtime={viewModel.runtime}
        safeArea={viewModel.safeArea}
        section={section}
        onNavigate={(route: ShellRoute) => {
          void navigate({ to: route });
        }}
        {...(viewModel.identity.native
          ? { onLogout: () => logout.mutate() }
          : {})}
      />
    );
  }

  return (
    <IdentityFoundationView
      password={password}
      selection={selection}
      viewModel={viewModel}
      onCredentialAutofill={applyAutofilledCredential}
      onAcknowledgeRecovery={(challenge) =>
        recoveryAcknowledgement.mutate(challenge)
      }
      onForgetRemembered={() => forgetRemembered.mutate()}
      onLogout={() => logout.mutate()}
      onPasswordChange={(nextPassword) => {
        pendingAutofillCredential.current = undefined;
        setPassword(nextPassword);
      }}
      onResolvePubDress={resolvePubDressNow}
      onSelectionChange={changeSelection}
      onSubmit={submitIdentity}
    />
  );
}

const foundationRouteTree = foundationRoute.addChildren([
  worldRoute,
  identityRoute,
  settingsRoute,
]);

const routeTree = rootRoute.addChildren([foundationRouteTree, mapRoute]);

export function ProductApp({
  core,
  host,
  identity,
  mapRenderer,
  routerBasepath = "/",
}: ProductAppProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [router] = useState(() =>
    createRouter({
      routeTree,
      basepath: routerBasepath,
      context: { dependencies: { core, host, identity, mapRenderer } },
    }),
  );

  useEffect(() => {
    host.ready();
  }, [host]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastViewportProvider>
        <FailureNoticeProvider>
          <RouterProvider router={router} />
        </FailureNoticeProvider>
      </ToastViewportProvider>
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
