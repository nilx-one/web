// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface IdentityProjection {
  pubDress: string;
  avaiaPubDress?: string;
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
  | { kind: "registered"; identity: IdentityProjection }
  | { kind: "not-registered" }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type ProviderRegistrationResult =
  | {
      kind: "registered";
      outcome: "created" | "already-registered";
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

export interface IdentityAccessPort {
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
