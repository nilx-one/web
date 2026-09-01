// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface IdentityProjection {
  pubDress: string;
}

export interface PubDressSelection {
  discriminator: string;
  slug: string;
}

export type IdentityLookupResult =
  | { kind: "registered"; identity: IdentityProjection }
  | { kind: "not-registered" }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type IdentityRegistrationResult =
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

export type PubDressAvailabilityResult =
  | { kind: "available" }
  | { kind: "unavailable" }
  | {
      kind: "rejected";
      reason:
        "authentication-required" | "invalid-length" | "invalid-character";
    }
  | { kind: "service-unavailable" };

export interface IdentityRegistrationPort {
  checkAvailability(
    selection: PubDressSelection,
  ): Promise<PubDressAvailabilityResult>;
  read(): Promise<IdentityLookupResult>;
  register(selection: PubDressSelection): Promise<IdentityRegistrationResult>;
}

export class CheckPubDressAvailability {
  public constructor(private readonly identity: IdentityRegistrationPort) {}

  public async execute(
    selection: PubDressSelection,
  ): Promise<PubDressAvailabilityResult> {
    try {
      return await this.identity.checkAvailability(selection);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class ReadIdentity {
  public constructor(private readonly identity: IdentityRegistrationPort) {}

  public async execute(): Promise<IdentityLookupResult> {
    try {
      return await this.identity.read();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class RegisterIdentity {
  public constructor(private readonly identity: IdentityRegistrationPort) {}

  public async execute(
    selection: PubDressSelection,
  ): Promise<IdentityRegistrationResult> {
    try {
      return await this.identity.register(selection);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}
