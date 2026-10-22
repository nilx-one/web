// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Mirrors Core's subscription v1 wire; Core alone resolves effective status. */
export type SubscriptionTier = "special" | "exclusive";
export interface SubscriptionSnapshot {
  readonly bond_pub_dress: string;
  readonly checked_at_ms: string;
  readonly refresh_after_ms: string;
  readonly entitlement: {
    readonly tier: SubscriptionTier;
    readonly starts_at_ms: string;
    readonly expires_at_ms: string;
  } | null;
}
export type SubscriptionStatus =
  | { readonly kind: "unknown" }
  | { readonly kind: "none"; readonly valid_until_ms: string }
  | {
      readonly kind: "active";
      readonly bond_pub_dress: string;
      readonly tier: SubscriptionTier;
      readonly valid_until_ms: string;
    };

/** Authenticated authority read. No browser persistence or client grant. */
export interface SubscriptionStatusPort {
  read(
    owner: string,
    signal: AbortSignal,
  ): Promise<SubscriptionSnapshot | null>;
  /** Invalidate immediately on grant, downgrade, revocation or session change. */
  subscribe(owner: string, invalidate: () => void): () => void;
}

/** Validate a Core response at the binding boundary; do not reimplement policy. */
export function decodeSubscriptionStatus(wire: string): SubscriptionStatus {
  const value: unknown = JSON.parse(wire);
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid subscription status");
  const status = value as Record<string, unknown>;
  if (status.kind === "unknown") return { kind: "unknown" };
  if (
    typeof status.valid_until_ms !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(status.valid_until_ms) ||
    BigInt(status.valid_until_ms) > 18446744073709551615n
  )
    throw new Error("Invalid subscription deadline");
  if (status.kind === "none")
    return { kind: "none", valid_until_ms: status.valid_until_ms };
  if (
    status.kind !== "active" ||
    typeof status.bond_pub_dress !== "string" ||
    (status.tier !== "special" && status.tier !== "exclusive")
  )
    throw new Error("Invalid subscription tier");
  return {
    kind: "active",
    bond_pub_dress: status.bond_pub_dress,
    tier: status.tier,
    valid_until_ms: status.valid_until_ms,
  };
}
