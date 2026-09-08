// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The published avatar studies a Bond may be represented by. The application
 * knows them as identity state; drawing them belongs to the map adapter.
 */
export type AvatarModel = "sky-study" | "dasha-study" | "kai-study";

export const AVATAR_MODELS: readonly AvatarModel[] = [
  "sky-study",
  "dasha-study",
  "kai-study",
];

export function isAvatarModel(value: unknown): value is AvatarModel {
  return (
    typeof value === "string" &&
    (AVATAR_MODELS as readonly string[]).includes(value)
  );
}

export interface IdentityProjection {
  pubDress: string;
  avaiaPubDress?: string;
  /** The body this Bond chose. Absent while it has chosen none. */
  avatarModel?: AvatarModel;
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
