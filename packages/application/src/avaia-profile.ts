// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The Avaia a Bond owns, as identity contract 8 keeps it.
 *
 * Configuration is what the owner decided and the service stored. It is never
 * what a device can run: a Bond configures its Avaia from a phone that could
 * not load a runtime, and an absent runtime does not make a configured Avaia
 * unconfigured. Nothing here is a protocol fact about two Bonds — this is one
 * owner naming what they own.
 */
export type AvaiaConfigurationState = "unconfigured" | "configured";

/** The owner-authenticated Avaia the identity service keeps. */
export interface AvaiaProfileProjection {
  /**
   * The full stored address. The service owns it, so it is carried whole
   * rather than rebuilt from a discriminator and a name this client assumed.
   */
  readonly pubDress: string;
  readonly ownerPubDress: string;
  readonly configurationState: AvaiaConfigurationState;
}

export type AvaiaProfileReadResult =
  | { kind: "available"; profile: AvaiaProfileProjection }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type AvaiaProfileUpdateRejection =
  | "authentication-required"
  | "invalid-address"
  | "owner-discriminator-mismatch"
  | "unavailable"
  | "rate-limited";

export type AvaiaProfileUpdateResult =
  | { kind: "updated"; profile: AvaiaProfileProjection }
  | { kind: "rejected"; reason: AvaiaProfileUpdateRejection }
  | { kind: "service-unavailable" };

/**
 * The Avaia profile capability, kept apart from `IdentityAccessPort` so a host
 * that has not reached contract 8 stays a valid identity client instead of
 * being required to answer for a capability its service does not publish.
 */
export interface AvaiaProfileAccessPort {
  readAvaiaProfile(): Promise<AvaiaProfileReadResult>;
  updateAvaiaProfile(pubDress: string): Promise<AvaiaProfileUpdateResult>;
}

/** Whether an identity client also answers for the Avaia profile. */
export function hasAvaiaProfileAccess(
  value: unknown,
): value is AvaiaProfileAccessPort {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AvaiaProfileAccessPort>;
  return (
    typeof candidate.readAvaiaProfile === "function" &&
    typeof candidate.updateAvaiaProfile === "function"
  );
}

export class ReadAvaiaProfile {
  public constructor(private readonly avaia: AvaiaProfileAccessPort) {}

  public async execute(): Promise<AvaiaProfileReadResult> {
    try {
      return await this.avaia.readAvaiaProfile();
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}

export class UpdateAvaiaProfile {
  public constructor(private readonly avaia: AvaiaProfileAccessPort) {}

  public async execute(pubDress: string): Promise<AvaiaProfileUpdateResult> {
    try {
      return await this.avaia.updateAvaiaProfile(pubDress);
    } catch {
      return { kind: "service-unavailable" };
    }
  }
}
