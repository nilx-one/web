// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvatarChoiceViewState } from "./avatar-choice-view-model";
import type {
  NativeAuthenticationResult,
  NativeIdentityContextResult,
  NativeRegistrationResult,
  ProviderIdentityLookupResult,
  ProviderRegistrationResult,
  ProviderPasswordResult,
  PubDressResolutionResult,
  PubDressSelection,
  StoredAvatarModel,
  RuntimeReadiness,
} from "@nilx-one/application";
import {
  hasAuthenticatedHostSession,
  type HostSnapshot,
} from "@nilx-one/host-contract";

export type RuntimeViewState =
  | {
      tone: "loading";
      label: "Loading shared Core";
      detail: "Checking the versioned WebAssembly boundary.";
    }
  | {
      tone: "ready";
      label: "Shared Core ready";
      detail: string;
    }
  | {
      tone: "blocked";
      label: "Shared Core required";
      detail: string;
    };

export type IdentityFormMode =
  | "initial"
  | "resolving"
  | "sign-in"
  | "register"
  | "remembered"
  | "provider-register";

export type PubDressStatusViewState =
  | { kind: "idle"; detail: "Case-sensitive · 2–32 characters" }
  | { kind: "checking"; detail: "Checking availability…" }
  | { kind: "available"; detail: "Available — create this identity" }
  | { kind: "registered"; detail: "Bond found — sign in" }
  | { kind: "unavailable"; detail: "Unavailable — this Bond already exists" }
  | { kind: "invalid"; detail: string }
  | {
      kind: "service-unavailable";
      detail: "Unavailable — couldn’t verify this identity";
    };

export type IdentityViewState =
  | {
      kind: "provider-password";
      pubDress: string;
      provider: ProviderPasswordLabel;
      busy: boolean;
      error?: string;
    }
  | { kind: "loading"; detail: string }
  | {
      kind: "form";
      mode: IdentityFormMode;
      status: PubDressStatusViewState;
      busy: boolean;
      error?: string;
      rememberedPubDress?: string;
    }
  | {
      /**
       * The body a new Bond is offered right after it becomes one. It is a
       * choice, not a step to get past: skipping it leaves the Bond with no
       * model recorded, and the profile keeps the same picker.
       */
      kind: "avatar-choice";
      pubDress: string;
      choice: AvatarChoiceViewState;
    }
  | {
      kind: "recovery-key";
      pubDress: string;
      recoveryKey: string;
      challenge: string;
      busy: boolean;
      error?: string;
    }
  | {
      kind: "authenticated";
      pubDress: string;
      avaiaPubDress?: string;
      /** The body this Bond chose, absent while it has chosen none. */
      avatarModel?: StoredAvatarModel;
      native: boolean;
    }
  | { kind: "unavailable"; detail: string }
  | { kind: "provider-required"; detail: string };

export interface IdentityFoundationViewModel {
  hostLabel: string;
  identity: IdentityViewState;
  runtime: RuntimeViewState;
  safeArea: HostSnapshot["safeArea"];
  showProviderRow: boolean;
}

function projectedAvaia(avaiaPubDress: string | undefined): {
  avaiaPubDress?: string;
} {
  return avaiaPubDress === undefined ? {} : { avaiaPubDress };
}

// A stored model may be newer than this client. The view state carries what
// the service recorded; narrowing to a study this build can draw happens where
// the body is chosen or rendered, never by dropping the person's choice here.
function projectedAvatar(avatarModel: StoredAvatarModel | undefined): {
  avatarModel?: StoredAvatarModel;
} {
  return avatarModel === undefined ? {} : { avatarModel };
}

/**
 * A newly registered Bond is asked which study represents it, once. An
 * identity that already recorded a choice, or a person who skipped, goes
 * straight to the world.
 */
export function createAvatarChoiceStepViewState(
  identity: Extract<IdentityViewState, { kind: "authenticated" }>,
  choice: AvatarChoiceViewState,
  offered: boolean,
): IdentityViewState {
  return offered && identity.avatarModel === undefined
    ? { kind: "avatar-choice", pubDress: identity.pubDress, choice }
    : identity;
}

export function createPubDressStatusViewState(
  selection: PubDressSelection,
  pending: boolean,
  result: PubDressResolutionResult | undefined,
): PubDressStatusViewState {
  const slugLength = [...selection.slug].length;
  if (slugLength === 0) {
    return { kind: "idle", detail: "Case-sensitive · 2–32 characters" };
  }
  if (slugLength < 2 || slugLength > 32) {
    return { kind: "invalid", detail: "Incorrect — use 2–32 characters" };
  }
  if (pending) {
    return { kind: "checking", detail: "Checking availability…" };
  }
  switch (result?.kind) {
    case "available":
      return {
        kind: "available",
        detail: "Available — create this identity",
      };
    case "registered":
      return {
        kind: "registered",
        detail: "Bond found — sign in",
      };
    case "rejected":
      return {
        kind: "invalid",
        detail:
          result.reason === "invalid-length"
            ? "Incorrect — use 2–32 characters"
            : "Incorrect — this character isn’t supported",
      };
    case "rate-limited":
    case "service-unavailable":
      return {
        kind: "service-unavailable",
        detail: "Unavailable — couldn’t verify this identity",
      };
    case undefined:
      return { kind: "idle", detail: "Case-sensitive · 2–32 characters" };
  }
}

export function createNativeIdentityViewState(
  context: NativeIdentityContextResult | undefined,
  status: PubDressStatusViewState,
  registration: NativeRegistrationResult | undefined,
  authentication: NativeAuthenticationResult | undefined,
  pending: boolean,
): IdentityViewState {
  if (authentication?.kind === "authenticated") {
    return {
      kind: "authenticated",
      pubDress: authentication.identity.pubDress,
      ...projectedAvaia(authentication.identity.avaiaPubDress),
      ...projectedAvatar(authentication.identity.avatarModel),
      native: true,
    };
  }
  if (registration?.kind === "recovery-key-required") {
    return {
      kind: "recovery-key",
      pubDress: registration.identity.pubDress,
      recoveryKey: registration.recoveryKey,
      challenge: registration.challenge,
      busy: pending,
      ...(authentication?.kind === "rejected"
        ? { error: nativeAuthenticationError(authentication) }
        : {}),
    };
  }
  if (context === undefined) {
    return { kind: "loading", detail: "Checking this browser…" };
  }
  if (context.kind === "service-unavailable") {
    return {
      kind: "unavailable",
      detail: "Identity authentication is temporarily unavailable.",
    };
  }
  if (context.kind === "authenticated") {
    return {
      kind: "authenticated",
      pubDress: context.identity.pubDress,
      ...projectedAvaia(context.identity.avaiaPubDress),
      ...projectedAvatar(context.identity.avatarModel),
      native: true,
    };
  }
  if (context.kind === "remembered") {
    return {
      kind: "form",
      mode: "remembered",
      status: {
        kind: "registered",
        detail: "Bond found — sign in",
      },
      busy: pending,
      rememberedPubDress: context.pubDress,
      ...nativeSubmissionError(registration, authentication),
    };
  }

  const mode: IdentityFormMode =
    status.kind === "checking"
      ? "resolving"
      : status.kind === "available"
        ? "register"
        : status.kind === "registered"
          ? "sign-in"
          : "initial";
  return {
    kind: "form",
    mode,
    status,
    busy: pending,
    ...nativeSubmissionError(registration, authentication),
  };
}

export function createProviderIdentityViewState(
  host: HostSnapshot,
  identity: ProviderIdentityLookupResult | undefined,
  registration: ProviderRegistrationResult | undefined,
  status: PubDressStatusViewState,
  pending: boolean,
  passwordSetup?: ProviderPasswordResult,
  acknowledgement?: NativeAuthenticationResult,
): IdentityViewState {
  if (!hasAuthenticatedHostSession(host)) {
    return {
      kind: "provider-required",
      detail: `Open 0x1 from ${providerLabel(host) ?? "this provider"} to continue.`,
    };
  }
  const registered =
    registration?.kind === "registered"
      ? registration
      : identity?.kind === "registered"
        ? identity
        : undefined;
  // Telegram and Discord both authorize an existing Bond that may still have no
  // native credential. The setup step belongs to the provider host, not to one
  // provider, so both reach it on the same condition.
  const passwordHost = providerPasswordLabel(host);
  if (
    passwordHost !== undefined &&
    registered !== undefined &&
    registered.passwordRequired !== false
  ) {
    if (
      acknowledgement?.kind === "authenticated" &&
      acknowledgement.identity.pubDress === registered.identity.pubDress
    ) {
      return {
        kind: "authenticated",
        pubDress: acknowledgement.identity.pubDress,
        ...projectedAvaia(acknowledgement.identity.avaiaPubDress),
        ...projectedAvatar(acknowledgement.identity.avatarModel),
        native: false,
      };
    }
    if (passwordSetup?.kind === "recovery-key-required") {
      return {
        kind: "recovery-key",
        pubDress: passwordSetup.identity.pubDress,
        recoveryKey: passwordSetup.recoveryKey,
        challenge: passwordSetup.challenge,
        busy: pending,
        ...(acknowledgement?.kind === "rejected"
          ? { error: nativeAuthenticationError(acknowledgement) }
          : acknowledgement?.kind === "service-unavailable"
            ? { error: "Couldn’t finish setup. Try again." }
            : {}),
      };
    }
    const error = providerPasswordError(passwordSetup, passwordHost);
    return {
      kind: "provider-password",
      pubDress: registered.identity.pubDress,
      provider: passwordHost,
      busy: pending,
      ...(error === undefined ? {} : { error }),
    };
  }
  if (registration?.kind === "registered") {
    return {
      kind: "authenticated",
      pubDress: registration.identity.pubDress,
      ...projectedAvaia(registration.identity.avaiaPubDress),
      ...projectedAvatar(registration.identity.avatarModel),
      native: false,
    };
  }
  if (identity?.kind === "registered") {
    return {
      kind: "authenticated",
      pubDress: identity.identity.pubDress,
      ...projectedAvaia(identity.identity.avaiaPubDress),
      ...projectedAvatar(identity.identity.avatarModel),
      native: false,
    };
  }
  if (identity === undefined) {
    return {
      kind: "loading",
      detail: `Checking this ${providerLabel(host) ?? "provider"} account…`,
    };
  }
  if (identity.kind === "service-unavailable") {
    return {
      kind: "unavailable",
      detail: "Identity registration is temporarily unavailable.",
    };
  }
  if (identity.kind === "authentication-required") {
    return {
      kind: "provider-required",
      detail: `Reopen 0x1 from ${providerLabel(host) ?? "the provider"}.`,
    };
  }

  const error = providerRegistrationError(registration);
  return {
    kind: "form",
    mode: "provider-register",
    status:
      status.kind === "registered"
        ? {
            kind: "unavailable",
            detail: "Unavailable — this Bond already exists",
          }
        : status,
    busy: pending,
    ...(error === undefined ? {} : { error }),
  };
}

export function createIdentityFoundationViewModel(
  host: HostSnapshot,
  readiness: RuntimeReadiness | undefined,
  identity: IdentityViewState,
): IdentityFoundationViewModel {
  return {
    hostLabel: hostLabel(host),
    identity,
    safeArea: host.safeArea,
    showProviderRow: host.kind === "browser" && identity.kind === "form",
    runtime: createRuntimeViewState(readiness),
  };
}

function nativeSubmissionError(
  registration: NativeRegistrationResult | undefined,
  authentication: NativeAuthenticationResult | undefined,
): { error?: string } {
  if (authentication?.kind === "rejected") {
    return { error: nativeAuthenticationError(authentication) };
  }
  if (authentication?.kind === "service-unavailable") {
    return { error: "Authentication is temporarily unavailable." };
  }
  if (registration?.kind === "service-unavailable") {
    return { error: "Registration is temporarily unavailable." };
  }
  if (registration?.kind !== "rejected") {
    return {};
  }
  switch (registration.reason) {
    case "invalid-password-length":
      return { error: "Use at least 8 characters." };
    case "compromised-password":
      return {
        error: "Choose a password that hasn’t appeared in known leaks.",
      };
    case "unavailable":
      return { error: "That pub_dress was just registered. Resolve it again." };
    case "already-committed":
      return {
        error:
          "Registration already committed and its recovery key can’t be shown again.",
      };
    case "rate-limited":
      return { error: "Too many attempts. Wait before trying again." };
  }
}

function nativeAuthenticationError(
  authentication: Extract<NativeAuthenticationResult, { kind: "rejected" }>,
): string {
  switch (authentication.reason) {
    case "invalid-credentials":
      return "The pub_dress or password is invalid.";
    case "invalid-challenge":
      return "This registration acknowledgement expired. Start again.";
    case "rate-limited":
      return "Too many attempts. Wait before trying again.";
  }
}

function providerRegistrationError(
  registration: ProviderRegistrationResult | undefined,
): string | undefined {
  if (registration?.kind === "service-unavailable") {
    return "Identity registration is temporarily unavailable.";
  }
  if (registration?.kind !== "rejected") {
    return undefined;
  }
  switch (registration.reason) {
    case "authentication-required":
      return "Reauthenticate with the provider and try again.";
    case "invalid-length":
      return "Use 2–32 characters after 0x.";
    case "invalid-character":
      return "That slug contains a character 0x1 does not accept.";
    case "unavailable":
      return "That pub_dress cannot be registered. Choose another one.";
  }
}

function createRuntimeViewState(
  readiness: RuntimeReadiness | undefined,
): RuntimeViewState {
  if (readiness === undefined) {
    return {
      tone: "loading",
      label: "Loading shared Core",
      detail: "Checking the versioned WebAssembly boundary.",
    };
  }
  if (readiness.kind === "ready") {
    return {
      tone: "ready",
      label: "Shared Core ready",
      detail: `Contract ${readiness.contractVersion} is available to the Web client.`,
    };
  }
  return {
    tone: "blocked",
    label: "Shared Core required",
    detail: blockedDetail(readiness.reason),
  };
}

function blockedDetail(
  reason: Extract<RuntimeReadiness, { kind: "blocked" }>["reason"],
): string {
  switch (reason) {
    case "artifact-missing":
      return "The versioned Rust artifact is not connected to this build. The interface will not invent its behavior in TypeScript.";
    case "binding-invalid":
      return "The loaded binding did not expose a valid contract version, so the client stopped before creating product state.";
    case "load-failed":
      return "The shared runtime could not be loaded. This remains a visible unavailable state.";
  }
}

function hostLabel(snapshot: HostSnapshot): string {
  return snapshot.available
    ? `${snapshot.kind} host`
    : `${snapshot.kind} unavailable`;
}

function providerLabel(
  host: HostSnapshot,
): "Telegram" | "Discord" | "0x1 for iOS" | undefined {
  switch (host.kind) {
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    case "native":
      return "0x1 for iOS";
    case "browser":
      return undefined;
  }
}

/** The provider hosts that can create a native password, by display name. */
export type ProviderPasswordLabel = "Telegram" | "Discord";

function providerPasswordLabel(
  host: HostSnapshot,
): ProviderPasswordLabel | undefined {
  switch (host.kind) {
    case "telegram":
      return "Telegram";
    case "discord":
      return "Discord";
    default:
      return undefined;
  }
}

function providerPasswordError(
  result: ProviderPasswordResult | undefined,
  provider: ProviderPasswordLabel,
): string | undefined {
  if (result?.kind === "service-unavailable")
    return "Couldn’t save your password. Try again.";
  if (result?.kind !== "rejected") return undefined;
  switch (result.reason) {
    case "authentication-required":
      return `Reopen 0x1 from ${provider} to continue.`;
    case "already-set":
      return "A password is already set. Reopen 0x1 to sign in.";
    case "invalid-password-length":
      return "Use 8–128 characters without surrounding whitespace or line breaks.";
    case "compromised-password":
      return "Choose a password that hasn’t appeared in known leaks.";
    case "rate-limited":
      return "Too many attempts. Wait before trying again.";
  }
}
