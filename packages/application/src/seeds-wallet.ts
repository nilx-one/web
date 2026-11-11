// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The Bond's one authoritative seeds wallet, as Identity projects it
 * (`GET /api/v1/identity/seeds`). Identity alone credits and debits it: Market
 * purchases, xPing repair and the once-only starter credit. A browser
 * inventory amount is never a balance anyone may spend or be shown as one.
 *
 * Core reads the service's answer (`nilxone-api`, through the runtime's
 * `readSeedsWalletAnswer`); no parser of it lives in Web.
 */
export interface SeedsWalletRead {
  /** Whole seeds, exact as a decimal string from the service. */
  readonly balance: bigint;
}

export type SeedsWalletRejection = "authentication-required" | "inactive";

export type SeedsWalletResult =
  | ({ readonly kind: "read" } & SeedsWalletRead)
  | { readonly kind: "rejected"; readonly reason: SeedsWalletRejection }
  | { readonly kind: "service-unavailable" };

export interface SeedsWalletAccessPort {
  readSeedsWallet(): Promise<SeedsWalletResult>;
}

export function hasSeedsWalletAccess(
  value: unknown,
): value is SeedsWalletAccessPort {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<SeedsWalletAccessPort>).readSeedsWallet ===
      "function"
  );
}
