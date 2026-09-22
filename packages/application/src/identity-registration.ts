// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BondProviderConnections,
  BondProviderType,
} from "./bond-providers";

/**
 * The avatar studies this client can choose and render. Identity responses may
 * carry a newer model id; preserve that explicit choice opaquely instead of
 * collapsing it into the absence of a choice.
 */
export const AVATAR_MODELS = [
  "sky-study",
  "dasha-study",
  "kai-study",
  "dasha-v2-study",
] as const;

export type PublishedAvatarModel = (typeof AVATAR_MODELS)[number];
/** A model this client publishes and is allowed to send as a new choice. */
export type AvatarModel = PublishedAvatarModel;
/** An explicit stored model id, including ids published by a newer runtime. */
export type StoredAvatarModel = string;

/**
 * Parses an explicit stored identity model id without assuming this client
 * publishes it. Rendering code must narrow against `AVATAR_MODELS` before
 * drawing it.
 */
export function isAvatarModel(value: unknown): value is StoredAvatarModel {
  return typeof value === "string" && value.length > 0;
}

export interface IdentityProjection {
  pubDress: string;
  avaiaPubDress?: string;
  /** The body this Bond chose. Absent only while it has chosen none. */
  avatarModel?: StoredAvatarModel;
  /**
   * The public address allocated for this Bond, absent while the identity
   * service has not allocated one. It is stored, not computed: the fold from a
   * case-sensitive `pub_dress` is not reversible.
   */
  pubDressUrl?: string;
}

export interface PubDressSelection {
  discriminator: string;
  slug: string;
}

export function formatPubDress(selection: PubDressSelection): string {
  return `0x${selection.discriminator}${selection.slug}`;
}

export function parsePubDress(value: string): PubDressSelection | undefined {
  if (!value.startsWith("0x") || value.length < 4) {
    return undefined;
  }
  const discriminator = value[2];
  if (
    discriminator === undefined ||
    !"0123456789abcdef".includes(discriminator)
  ) {
    return undefined;
  }
  return { discriminator, slug: value.slice(3) };
}

/**
 * The availability of a public label, resolved against the identity service.
 * `registered` means another Bond already folded onto this label, which is the
 * point at which the Bond chooses a distinguishing suffix.
 */
export type PubDressLabelResolutionResult =
  | { kind: "available"; label: string }
  | { kind: "registered"; label: string }
  | { kind: "rejected"; reason: "invalid-label" }
  | { kind: "rate-limited" }
  | { kind: "service-unavailable" };

export type PubDressResolutionResult =
  | { kind: "available"; pubDress: string }
  | { kind: "registered"; pubDress: string }
  | {
      kind: "rejected";
      reason: "invalid-length" | "invalid-character";
    }
  | { kind: "rate-limited" }
  | { kind: "service-unavailable" };

export type NativeIdentityContextResult =
  | { kind: "anonymous" }
  | { kind: "remembered"; pubDress: string }
  | { kind: "authenticated"; identity: IdentityProjection }
  | { kind: "service-unavailable" };

export type NativeRegistrationResult =
  | {
      kind: "recovery-key-required";
      identity: IdentityProjection;
      recoveryKey: string;
      challenge: string;
    }
  | {
      kind: "rejected";
      reason:
        | "invalid-password-length"
        | "compromised-password"
        | "unavailable"
        | "already-committed"
        | "rate-limited";
    }
  | { kind: "service-unavailable" };

export type NativeAuthenticationResult =
  | { kind: "authenticated"; identity: IdentityProjection }
  | {
      kind: "rejected";
      reason: "invalid-credentials" | "invalid-challenge" | "rate-limited";
    }
  | { kind: "service-unavailable" };

export type NativeRecoveryResult =
  | {
      kind: "recovered";
      identity: IdentityProjection;
      replacementRecoveryKey: string;
    }
  | {
      kind: "rejected";
      reason:
        | "invalid-recovery-material"
        | "invalid-password-length"
        | "compromised-password"
        | "rate-limited";
    }
  | { kind: "service-unavailable" };

export type NativeMutationResult =
  | { kind: "completed" }
  | { kind: "rejected" }
  | { kind: "service-unavailable" };

export type ProviderIdentityLookupResult =
  | {
      kind: "registered";
      identity: IdentityProjection;
      passwordRequired?: boolean;
    }
  | { kind: "not-registered" }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type ProviderRegistrationResult =
  | {
      kind: "registered";
      outcome: "created" | "already-registered";
      passwordRequired?: boolean;
      identity: IdentityProjection;
    }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "invalid-length"
        | "invalid-character"
        | "unavailable";
    }
  | { kind: "service-unavailable" };

/**
 * The provider hosts that can create a native password for the Bond their
 * verified account already owns. Both endpoints are the same operation under a
 * different verified provider, so the host is an argument rather than a branch.
 */
export type ProviderPasswordHost = "telegram" | "discord";

/** Choosing a body changes identity state and nothing else about the Bond. */
export type AvatarModelResult =
  | { kind: "chosen"; identity: IdentityProjection }
  | {
      kind: "rejected";
      reason: "authentication-required" | "unknown-model" | "rate-limited";
    }
  | { kind: "service-unavailable" };

export type ProviderPasswordResult =
  | Extract<NativeRegistrationResult, { kind: "recovery-key-required" }>
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "already-set"
        | "invalid-password-length"
        | "compromised-password"
        | "rate-limited";
    }
  | { kind: "service-unavailable" };

export type BrowserIdentityProvider = "telegram" | "discord" | "github";

export interface BrowserProviderAvailability {
  telegram: boolean;
  discord: boolean;
  github: boolean;
}

export type BrowserProviderContextResult =
  | { kind: "none"; available: BrowserProviderAvailability }
  | {
      kind: "pending";
      provider: BrowserIdentityProvider;
      available: BrowserProviderAvailability;
    }
  | { kind: "service-unavailable" };

export type BrowserProviderLinkResult =
  | { kind: "linked"; provider: BrowserIdentityProvider }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "provider-proof-required"
        | "provider-already-linked"
        | "provider-type-already-linked"
        | "session-changed";
    }
  | { kind: "service-unavailable" };

export type BrowserProviderConnectionsResult =
  | { kind: "available"; connections: BondProviderConnections }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type BrowserProviderDisconnectResult =
  | { kind: "disconnected"; provider: BondProviderType }
  | {
      kind: "rejected";
      reason: "authentication-required" | "not-connected";
    }
  | { kind: "service-unavailable" };

/**
 * Detaching the provider that authenticated this very session, at that
 * provider's own request — the Mini App Settings button and the Telegram
 * bot's `/unlink` command are the same operation under two surfaces. Unlike
 * {@link BrowserProviderDisconnectResult}, there is no `provider` to name:
 * the service resolves it from the caller's own proof, never from anything
 * the client sends.
 */
export type ProviderSelfDisconnectResult =
  | { kind: "disconnected" }
  | {
      kind: "rejected";
      reason: "authentication-required" | "not-connected" | "sole-access-path";
    }
  | { kind: "service-unavailable" };

/**
 * Renaming moves the same Bond to another address it may hold. The
 * discriminator is not part of the request: the service keeps the one the Bond
 * registered under, and the owned Avaia address follows its owner.
 */
export type PubDressRenameResult =
  | { kind: "renamed"; identity: IdentityProjection }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "invalid-length"
        | "invalid-character"
        | "invalid-avaia-suffix"
        | "unavailable"
        | "avaia-unavailable"
        | "rate-limited";
    }
  | { kind: "service-unavailable" };

export interface IdentityAccessPort {
  chooseAvatarModel(model: AvatarModel): Promise<AvatarModelResult>;
  renameAvaiaSlug(slug: string): Promise<PubDressRenameResult>;
  renamePubDressSlug(slug: string): Promise<PubDressRenameResult>;
  setProviderPassword(
    host: ProviderPasswordHost,
    password: string,
  ): Promise<ProviderPasswordResult>;
  acknowledgeRecoveryKey(
    challenge: string,
  ): Promise<NativeAuthenticationResult>;
  authenticateNative(
    pubDress: string,
    password: string,
  ): Promise<NativeAuthenticationResult>;
  forgetRememberedBond(): Promise<NativeMutationResult>;
  logoutNative(): Promise<NativeMutationResult>;
  readNativeContext(): Promise<NativeIdentityContextResult>;
  readProviderIdentity(): Promise<ProviderIdentityLookupResult>;
  recoverNative(
    pubDress: string,
    recoveryKey: string,
    newPassword: string,
  ): Promise<NativeRecoveryResult>;
  registerNative(
    pubDress: string,
    password: string,
    idempotencyKey: string,
  ): Promise<NativeRegistrationResult>;
  registerProvider(
    selection: PubDressSelection,
  ): Promise<ProviderRegistrationResult>;
  resolvePubDress(
    selection: PubDressSelection,
  ): Promise<PubDressResolutionResult>;
  resolvePubDressLabel(label: string): Promise<PubDressLabelResolutionResult>;
  /** Browser-only provider authorization surface. */
  browserProviderAuthorizationUrl?(
    provider: BrowserIdentityProvider,
    intent?: "connect",
  ): string;
  /** Browser-only pending provider proof and provider availability. */
  readBrowserProviderContext?(): Promise<BrowserProviderContextResult>;
  /**
   * Links pending verified provider proof to the currently authenticated Bond.
   * `expectedPubDress` is a race guard, never authority to select another Bond.
   */
  linkBrowserProvider?(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult>;
  /** Authenticated browser projection of the provider bindings this Bond owns. */
  readBrowserProviderConnections?(): Promise<BrowserProviderConnectionsResult>;
  /**
   * Removes only the 0x1 binding. The external provider account is outside this
   * port and cannot be deleted by this operation.
   */
  disconnectBrowserProvider?(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult>;
  /**
   * Self-service disconnect for a host that is itself the provider (Telegram,
   * eventually Discord): detaches whichever identity this session's own proof
   * names, the same self-service the host's own bot command performs. A
   * browser tab has no provider proof of its own and does not implement this.
   */
  disconnectSelfProvider?(): Promise<ProviderSelfDisconnectResult>;
}

export class ResolvePubDress {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    selection: PubDressSelection,
  ): Promise<PubDressResolutionResult> {
    try {
      return await this.identity.resolvePubDress(selection);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

/**
 * Advisory, exactly like {@link ResolvePubDress}. The allocating transaction in
 * the identity service stays the only collision boundary, so a label may still
 * be taken between this answer and registration.
 */
export class ResolvePubDressLabel {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(label: string): Promise<PubDressLabelResolutionResult> {
    try {
      return await this.identity.resolvePubDressLabel(label);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ReadNativeIdentityContext {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<NativeIdentityContextResult> {
    try {
      return await this.identity.readNativeContext();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class RegisterNativeIdentity {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    pubDress: string,
    password: string,
    idempotencyKey: string,
  ): Promise<NativeRegistrationResult> {
    try {
      return await this.identity.registerNative(
        pubDress,
        password,
        idempotencyKey,
      );
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class AuthenticateNativeIdentity {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    pubDress: string,
    password: string,
  ): Promise<NativeAuthenticationResult> {
    try {
      return await this.identity.authenticateNative(pubDress, password);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class AcknowledgeRecoveryKey {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(challenge: string): Promise<NativeAuthenticationResult> {
    try {
      return await this.identity.acknowledgeRecoveryKey(challenge);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ForgetRememberedBond {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<NativeMutationResult> {
    try {
      return await this.identity.forgetRememberedBond();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class LogoutNativeIdentity {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<NativeMutationResult> {
    try {
      return await this.identity.logoutNative();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ReadProviderIdentity {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<ProviderIdentityLookupResult> {
    try {
      return await this.identity.readProviderIdentity();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class RegisterProviderIdentity {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    selection: PubDressSelection,
  ): Promise<ProviderRegistrationResult> {
    try {
      return await this.identity.registerProvider(selection);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ChooseAvatarModel {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(model: AvatarModel): Promise<AvatarModelResult> {
    try {
      return await this.identity.chooseAvatarModel(model);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class RenameAvaiaSlug {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(slug: string): Promise<PubDressRenameResult> {
    try {
      return await this.identity.renameAvaiaSlug(slug);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class RenamePubDressSlug {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(slug: string): Promise<PubDressRenameResult> {
    try {
      return await this.identity.renamePubDressSlug(slug);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class SetProviderPassword {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    host: ProviderPasswordHost,
    password: string,
  ): Promise<ProviderPasswordResult> {
    try {
      return await this.identity.setProviderPassword(host, password);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class BeginBrowserProviderAuthorization {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public execute(
    provider: BrowserIdentityProvider,
    intent?: "connect",
  ): string | undefined {
    return this.identity.browserProviderAuthorizationUrl?.(provider, intent);
  }
}

export class ReadBrowserProviderContext {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<BrowserProviderContextResult> {
    const read = this.identity.readBrowserProviderContext;
    if (read === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await read.call(this.identity);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class LinkBrowserProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    expectedPubDress: string,
  ): Promise<BrowserProviderLinkResult> {
    const link = this.identity.linkBrowserProvider;
    if (link === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await link.call(this.identity, expectedPubDress);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ReadBrowserProviderConnections {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<BrowserProviderConnectionsResult> {
    const read = this.identity.readBrowserProviderConnections;
    if (read === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await read.call(this.identity);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class DisconnectBrowserProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(
    provider: BondProviderType,
  ): Promise<BrowserProviderDisconnectResult> {
    const disconnect = this.identity.disconnectBrowserProvider;
    if (disconnect === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await disconnect.call(this.identity, provider);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class DisconnectSelfProvider {
  public constructor(private readonly identity: IdentityAccessPort) {}

  public async execute(): Promise<ProviderSelfDisconnectResult> {
    const disconnect = this.identity.disconnectSelfProvider;
    if (disconnect === undefined) {
      return { kind: "service-unavailable" };
    }
    try {
      return await disconnect.call(this.identity);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}
