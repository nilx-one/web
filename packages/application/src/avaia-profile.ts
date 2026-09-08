// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Persisted setup state for the owned Avaia identity. Runtime availability is
 * deliberately not represented here; that remains a host/device fact. */
export type AvaiaConfigurationState = "unconfigured" | "configured";

/** The owner-authenticated Avaia profile projected by identity contract 8. */
export interface AvaiaProfileProjection {
  readonly pubDress: string;
  readonly ownerPubDress: string;
  readonly configurationState: AvaiaConfigurationState;
  /** Reserved by the service. `null` means no model capability is published. */
  readonly modelRef: string | null;
}

export type AvaiaProfileReadResult =
  | { kind: "available"; profile: AvaiaProfileProjection }
  | { kind: "authentication-required" }
  | { kind: "service-unavailable" };

export type AvaiaProfileUpdateResult =
  | { kind: "updated"; profile: AvaiaProfileProjection }
  | {
      kind: "rejected";
      reason:
        | "authentication-required"
        | "invalid-address"
        | "owner-discriminator-mismatch"
        | "unavailable"
        | "rate-limited";
    }
  | { kind: "service-unavailable" };

/**
 * Narrow identity/profile capability consumed by the setup surface. It is kept
 * separate from `IdentityAccessPort` so older identity clients remain valid
 * while hosts opt in to contract 8.
 */
export interface AvaiaProfileAccessPort {
  readAvaiaProfile(): Promise<AvaiaProfileReadResult>;
  updateAvaiaProfile(pubDress: string): Promise<AvaiaProfileUpdateResult>;
}

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
