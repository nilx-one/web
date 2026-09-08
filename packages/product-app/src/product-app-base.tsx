// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AcknowledgeRecoveryKey,
  ChooseAvatarModel,
  AuthenticateNativeIdentity,
  BeginBrowserProviderAuthorization,
  ForgetRememberedBond,
  LinkBrowserProvider,
  LogoutNativeIdentity,
  ReadBrowserProviderContext,
  ReadNativeIdentityContext,
  ReadProviderIdentity,
  ReadRuntimeReadiness,
  RegisterNativeIdentity,
  RegisterProviderIdentity,
  RenameAvaiaSlug,
  RenamePubDressSlug,
  SetProviderPassword,
  ResolvePubDress,
  formatPubDress,
  type BondProviderType,
  type BrowserIdentityProvider,
  type CoreRuntimePort,
  type IdentityAccessPort,
  type AvatarModel,
  type ProviderPasswordHost,
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
  type IdentityViewState,
} from "./features/identity/identity-foundation-view-model";
import { normalizePubDressCredentialInput } from "./features/identity/pub-dress-credential-input";
import { createAvatarChoiceViewState } from "./features/identity/avatar-choice-view-model";
import { useBondProviderConnections } from "./features/identity/use-bond-provider-connections";
import { createAvatarChoiceStepViewState } from "./features/identity/identity-foundation-view-model";
import {
  createAvaiaSlugViewState,
  createProfileSlugViewState,
} from "./features/identity/profile-slug-view-model";
import { AuthenticatedMapHomeView } from "./features/map/authenticated-map-home-view";
import { avaiaAvailability } from "./features/map/bond-dock-view-model";
import { MapFoundationView } from "./features/map/map-foundation-view";
import {
  applyAppearance,
  declareDeviceAppearance,
  useAppearance,
} from "./shell/appearance";
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

// Password setup belongs to a verified provider session. A host without one
// never reaches this state, and never names a provider the service would trust.
function providerPasswordHost(
  kind: HostSnapshot["kind"],
): ProviderPasswordHost | undefined {
  switch (kind) {
    case "telegram":
      return "telegram";
    case "discord":
      return "discord";
    default:
      return undefined;
  }
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

function providerDisplayName(provider: BrowserIdentityProvider): string {
  return provider === "telegram" ? "Telegram" : "Discord";
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
  const appearance = useAppearance();
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
  // Undefined means the profile is showing the address the service holds.
  const [slugDraft, setSlugDraft] = useState<string | undefined>(undefined);
  // A new Bond is asked for a body once. Deciding later is a real answer, so
  // the step is not offered again in this session.
  const [avatarStepDeclined, setAvatarStepDeclined] = useState(false);
  const [avaiaDraft, setAvaiaDraft] = useState<string | undefined>(undefined);
  const pendingAutofillCredential = useRef<
    PendingAutofillCredential | undefined
  >(undefined);

  const readinessQuery = useQuery({
    queryKey: ["core-runtime-readiness"],
    queryFn: () => new ReadRuntimeReadiness(dependencies.core).execute(),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const pubDressLabelSlugLength = [...selection.slug].length;
  const pubDressLabelEnabled =
    pubDressLabelSlugLength >= 2 &&
    pubDressLabelSlugLength <= 32 &&
    dependencies.core.derivePubDressLabel !== undefined;
  const pubDressLabelQuery = useQuery({
    queryKey: ["core-pub-dress-label", selection.discriminator, selection.slug],
    queryFn: () => {
      const derive = dependencies.core.derivePubDressLabel;
      if (derive === undefined) {
        throw new Error("0x1 Core PubDress label derivation is unavailable");
      }
      return derive.call(dependencies.core, formatPubDress(selection));
    },
    enabled: pubDressLabelEnabled,
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
  const browserProviderContextQuery = useQuery({
    queryKey: ["browser-provider-context"],
    queryFn: () =>
      new ReadBrowserProviderContext(dependencies.identity).execute(),
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
  const providerPassword = useMutation({
    mutationFn: (host: ProviderPasswordHost) =>
      new SetProviderPassword(dependencies.identity).execute(host, password),
    gcTime: 0,
    onSuccess: (result) => {
      if (result.kind === "recovery-key-required") setPassword("");
    },
  });
  const browserProviderLink = useMutation({
    mutationFn: (expectedPubDress: string) =>
      new LinkBrowserProvider(dependencies.identity).execute(expectedPubDress),
    onSuccess: (result) => {
      if (result.kind === "linked") {
        void queryClient.invalidateQueries({
          queryKey: ["browser-provider-context"],
        });
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
      browserProviderLink.reset();
      setSelection({ discriminator: "0", slug: "" });
      setPassword("");
      setIdempotencyKey(newIdempotencyKey());
      setUseRememberedHint(false);
      pendingAutofillCredential.current = undefined;
    },
  });
  // A renamed address makes every projection of the previous one stale: the
  // mutation results that still name it, and both identity queries.
  async function refreshIdentityProjections(): Promise<void> {
    nativeRegistration.reset();
    nativeAuthentication.reset();
    recoveryAcknowledgement.reset();
    providerRegistration.reset();
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["native-identity-context"],
      }),
      queryClient.invalidateQueries({ queryKey: ["provider-identity"] }),
    ]);
  }

  // The addresses a Bond may edit. A draft is local until the service accepts
  // it, and nothing else in the profile is a choice this surface can offer.
  const renameSlug = useMutation({
    mutationFn: (slug: string) =>
      new RenamePubDressSlug(dependencies.identity).execute(slug),
    gcTime: 0,
    onSuccess: async (result) => {
      if (result.kind !== "renamed") return;
      setSlugDraft(undefined);
      await refreshIdentityProjections();
    },
  });
  // Choosing a body is identity state, so it is saved where the Bond is, not
  // in this device's interface preferences.
  const chooseAvatar = useMutation({
    mutationFn: (model: AvatarModel) =>
      new ChooseAvatarModel(dependencies.identity).execute(model),
    gcTime: 0,
    onSuccess: async (result) => {
      if (result.kind !== "chosen") return;
      await refreshIdentityProjections();
    },
  });
  const renameAvaia = useMutation({
    mutationFn: (slug: string) =>
      new RenameAvaiaSlug(dependencies.identity).execute(slug),
    gcTime: 0,
    onSuccess: async (result) => {
      if (result.kind !== "renamed") return;
      setAvaiaDraft(undefined);
      await refreshIdentityProjections();
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
      browserProviderLink.reset();
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
  const nativeIdentityState = createNativeIdentityViewState(
    nativeContextQuery.data?.kind === "remembered" && !useRememberedHint
      ? { kind: "anonymous" }
      : nativeContextQuery.data,
    status,
    nativeRegistration.data,
    latestAuthentication,
    nativePending,
  );
  const pendingBrowserProvider =
    browserProviderContextQuery.data?.kind === "pending"
      ? browserProviderContextQuery.data.provider
      : undefined;
  // The provider a session was proved through is the one attachment this
  // client can attest to. A Bond's full set of attachments is a service fact
  // no endpoint answers yet, so nothing here invents one.
  const attestedProvider: BondProviderType | undefined =
    host.kind === "telegram" || host.kind === "discord"
      ? host.kind
      : browserProviderLink.data?.kind === "linked"
        ? browserProviderLink.data.provider
        : undefined;
  const providers = useBondProviderConnections(
    attestedProvider === undefined ? [] : [{ provider: attestedProvider }],
  );
  const authenticatedNativePubDress =
    nativeIdentityState.kind === "authenticated"
      ? nativeIdentityState.pubDress
      : undefined;

  useEffect(() => {
    if (
      !browserHost ||
      pendingBrowserProvider === undefined ||
      authenticatedNativePubDress === undefined ||
      browserProviderLink.isPending ||
      browserProviderLink.data !== undefined
    ) {
      return;
    }
    browserProviderLink.mutate(authenticatedNativePubDress);
  }, [
    authenticatedNativePubDress,
    browserHost,
    browserProviderLink,
    pendingBrowserProvider,
  ]);

  let identityState: IdentityViewState = browserHost
    ? nativeIdentityState
    : createProviderIdentityViewState(
        host,
        providerIdentityQuery.data,
        providerRegistration.data,
        status,
        providerRegistration.isPending ||
          providerPassword.isPending ||
          recoveryAcknowledgement.isPending,
        providerPassword.data,
        recoveryAcknowledgement.data,
      );
  if (
    browserHost &&
    pendingBrowserProvider !== undefined &&
    nativeIdentityState.kind === "authenticated"
  ) {
    const provider = providerDisplayName(pendingBrowserProvider);
    const linkResult = browserProviderLink.data;
    if (linkResult?.kind === "linked") {
      identityState = nativeIdentityState;
    } else if (linkResult?.kind === "rejected") {
      identityState = {
        kind: "unavailable",
        detail:
          linkResult.reason === "provider-already-linked"
            ? `${provider} is already connected to another Bond.`
            : `Could not connect ${provider} to this Bond. Authorize ${provider} again.`,
      };
    } else if (linkResult?.kind === "service-unavailable") {
      identityState = {
        kind: "unavailable",
        detail: `Could not connect ${provider} right now.`,
      };
    } else {
      identityState = {
        kind: "loading",
        detail: `Connecting ${provider} to ${nativeIdentityState.pubDress}…`,
      };
    }
  }
  const avatarChoice = createAvatarChoiceViewState(
    identityState.kind === "authenticated"
      ? identityState.avatarModel
      : undefined,
    chooseAvatar.isPending ? chooseAvatar.variables : undefined,
    chooseAvatar.data,
  );
  // Registration is the one moment a body is offered without being asked for:
  // a Bond that just came into existence, before its world opens.
  const registeredThisSession =
    nativeRegistration.data?.kind === "recovery-key-required" ||
    providerPassword.data?.kind === "recovery-key-required";
  const viewModel = createIdentityFoundationViewModel(
    host,
    readinessQuery.data,
    identityState.kind === "authenticated"
      ? createAvatarChoiceStepViewState(
          identityState,
          avatarChoice,
          registeredThisSession && !avatarStepDeclined,
        )
      : identityState,
  );

  // The host answers for the device; the appearance store resolves a person's
  // standing choice over it. One resolution, stamped once on the document, is
  // what keeps the sign-in surface and the world the same colour.
  useEffect(() => {
    declareDeviceAppearance(host.theme);
    document.documentElement.dataset.host = host.kind;
  }, [host.kind, host.theme]);

  useEffect(() => {
    applyAppearance(appearance.resolved);
  }, [appearance.resolved]);

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
    if (!browserHost) return;
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
    if (identityState.kind === "provider-password") {
      const providerHost = providerPasswordHost(host.kind);
      if (
        providerHost !== undefined &&
        !identityState.busy &&
        validNativePassword(password)
      ) {
        recoveryAcknowledgement.reset();
        providerPassword.mutate(providerHost);
      }
      return;
    }
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
        if (status.kind !== "available") return;
        providerRegistration.mutate(selection);
        break;
      case "initial":
      case "resolving":
        break;
    }
  }

  function authorizeBrowserProvider(provider: BrowserIdentityProvider): void {
    const url = new BeginBrowserProviderAuthorization(
      dependencies.identity,
    ).execute(provider);
    if (url !== undefined) {
      window.location.assign(url);
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
        geolocation={dependencies.host.geolocation}
        runtime={viewModel.runtime}
        safeArea={viewModel.safeArea}
        section={section}
        connectedProviders={providers.connections}
        onDisconnectProvider={providers.disconnect}
        // A host that is itself the provider can follow that provider's URL
        // scheme. Every other host is offered the web address instead.
        providerDeepLinks={
          attestedProvider === undefined ? [] : [attestedProvider]
        }
        onNavigate={(route: ShellRoute) => {
          void navigate({ to: route });
        }}
        avaiaAvailability={avaiaAvailability({
          // No Avaia runtime is published yet, so there is nothing to fetch on
          // any device. The Dock states the truth rather than an intention.
          acceleratedGraphics: "gpu" in navigator,
        })}
        slugEdit={createProfileSlugViewState(
          viewModel.identity.pubDress,
          slugDraft,
          renameSlug.isPending,
          renameSlug.data,
        )}
        avaiaEdit={createAvaiaSlugViewState(
          viewModel.identity.avaiaPubDress,
          viewModel.identity.pubDress,
          avaiaDraft,
          renameAvaia.isPending,
          renameAvaia.data,
        )}
        onSlugChange={(next: string) => {
          renameSlug.reset();
          setSlugDraft(next);
        }}
        onSlugSubmit={() => {
          if (slugDraft !== undefined && !renameSlug.isPending) {
            renameSlug.mutate(slugDraft);
          }
        }}
        onAvaiaChange={(next: string) => {
          renameAvaia.reset();
          setAvaiaDraft(next);
        }}
        avatarChoice={avatarChoice}
        onAvatarChoice={(model) => {
          if (!chooseAvatar.isPending) chooseAvatar.mutate(model);
        }}
        onAvaiaSubmit={() => {
          if (avaiaDraft !== undefined && !renameAvaia.isPending) {
            renameAvaia.mutate(avaiaDraft);
          }
        }}
        {...(viewModel.identity.avaiaPubDress === undefined
          ? {}
          : { avaiaPubDress: viewModel.identity.avaiaPubDress })}
        {...(viewModel.identity.native
          ? { onLogout: () => logout.mutate() }
          : {})}
      />
    );
  }

  const providerContext = browserProviderContextQuery.data;
  const browserProviderAuth = browserHost
    ? {
        available:
          providerContext?.kind === "none" ||
          providerContext?.kind === "pending"
            ? providerContext.available
            : { telegram: false, discord: false },
        onAuthorize: authorizeBrowserProvider,
        ...(pendingBrowserProvider === undefined
          ? {}
          : { pendingProvider: pendingBrowserProvider }),
      }
    : undefined;

  return (
    <IdentityFoundationView
      password={password}
      pubDressLabelDerivation={pubDressLabelQuery.data}
      pubDressLabelDerivationPending={
        pubDressLabelEnabled && pubDressLabelQuery.isFetching
      }
      selection={selection}
      viewModel={viewModel}
      {...(browserProviderAuth === undefined ? {} : { browserProviderAuth })}
      onCredentialAutofill={applyAutofilledCredential}
      onAvatarChoice={(model) => {
        if (!chooseAvatar.isPending) chooseAvatar.mutate(model);
      }}
      onSkipAvatarChoice={() => setAvatarStepDeclined(true)}
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
