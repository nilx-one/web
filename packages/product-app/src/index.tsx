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
  formatPubDress,
  type CoreRuntimePort,
  type IdentityAccessPort,
  type PubDressSelection,
} from "@nilx-one/application";
import {
  hasAuthenticatedHostSession,
  type HostPort,
  type HostSnapshot,
} from "@nilx-one/host-contract";
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
} from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { IdentityFoundationView } from "./features/identity/identity-foundation-view";
import {
  createIdentityFoundationViewModel,
  createNativeIdentityViewState,
  createProviderIdentityViewState,
  createPubDressStatusViewState,
} from "./features/identity/identity-foundation-view-model";
import "./product.css";

export interface ProductAppDependencies {
  core: CoreRuntimePort;
  host: HostPort;
  identity: IdentityAccessPort;
}

export interface ProductAppProps extends ProductAppDependencies {
  routerBasepath?: string;
}

interface ProductRouterContext {
  dependencies: ProductAppDependencies;
}

function useHostSnapshot(host: HostPort): HostSnapshot {
  const [snapshot, setSnapshot] = useState(() => host.getSnapshot());
  useEffect(() => host.subscribe(setSnapshot), [host]);
  return snapshot;
}

function useDebouncedSelection(selection: PubDressSelection) {
  const [debounced, setDebounced] = useState(selection);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(selection), 320);
    return () => window.clearTimeout(timeout);
  }, [selection]);
  return debounced;
}

function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `0x1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function RootRoute() {
  return <Outlet />;
}

const rootRoute = createRootRouteWithContext<ProductRouterContext>()({
  component: RootRoute,
});

const foundationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: FoundationRoute,
});

function FoundationRoute() {
  const { dependencies } = foundationRoute.useRouteContext();
  const queryClient = useQueryClient();
  const host = useHostSnapshot(dependencies.host);
  const browserHost = host.kind === "browser";
  const [selection, setSelection] = useState<PubDressSelection>({
    discriminator: "0",
    slug: "",
  });
  const [password, setPassword] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const debouncedSelection = useDebouncedSelection(selection);

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

  const selectionIsDebounced =
    selection.discriminator === debouncedSelection.discriminator &&
    selection.slug === debouncedSelection.slug;
  const nativeCanResolve = nativeContextQuery.data?.kind === "anonymous";
  const providerCanResolve =
    providerIdentityQuery.data?.kind === "not-registered";
  const resolutionEnabled =
    (browserHost ? nativeCanResolve : providerCanResolve) &&
    [...debouncedSelection.slug].length >= 2 &&
    [...debouncedSelection.slug].length <= 32;
  const resolutionQuery = useQuery({
    queryKey: [
      "pub-dress-resolution",
      debouncedSelection.discriminator,
      debouncedSelection.slug,
    ],
    queryFn: () =>
      new ResolvePubDress(dependencies.identity).execute(debouncedSelection),
    enabled: resolutionEnabled,
    retry: false,
    staleTime: 0,
  });
  const status = createPubDressStatusViewState(
    selection,
    [...selection.slug].length >= 2 &&
      (!selectionIsDebounced || resolutionQuery.isFetching),
    selectionIsDebounced ? resolutionQuery.data : undefined,
  );

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
        nativeContextQuery.data,
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

  const resolvedPubDress = useMemo(() => {
    if (identityState.kind === "form" && identityState.mode === "remembered") {
      return identityState.rememberedPubDress ?? formatPubDress(selection);
    }
    return formatPubDress(selection);
  }, [identityState, selection]);

  useEffect(() => {
    document.documentElement.dataset.hostTheme = host.theme;
    document.documentElement.dataset.host = host.kind;
  }, [host.kind, host.theme]);

  function changeSelection(next: PubDressSelection): void {
    setSelection(next);
    setPassword("");
    setIdempotencyKey(newIdempotencyKey());
    nativeRegistration.reset();
    nativeAuthentication.reset();
  }

  function submitIdentity(): void {
    if (identityState.kind !== "form" || identityState.busy) {
      return;
    }
    switch (identityState.mode) {
      case "sign-in":
      case "remembered":
        nativeAuthentication.reset();
        recoveryAcknowledgement.reset();
        nativeAuthentication.mutate({
          pubDress: resolvedPubDress,
          password,
        });
        break;
      case "register":
        nativeRegistration.mutate({ pubDress: resolvedPubDress, password });
        break;
      case "provider-register":
        providerRegistration.mutate(selection);
        break;
      case "initial":
      case "resolving":
        break;
    }
  }

  return (
    <IdentityFoundationView
      password={password}
      selection={selection}
      viewModel={viewModel}
      onAcknowledgeRecovery={(challenge) =>
        recoveryAcknowledgement.mutate(challenge)
      }
      onForgetRemembered={() => forgetRemembered.mutate()}
      onLogout={() => logout.mutate()}
      onPasswordChange={setPassword}
      onSelectionChange={changeSelection}
      onSubmit={submitIdentity}
    />
  );
}

const routeTree = rootRoute.addChildren([foundationRoute]);

export function ProductApp({
  core,
  host,
  identity,
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
      context: { dependencies: { core, host, identity } },
    }),
  );

  useEffect(() => {
    host.ready();
  }, [host]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
