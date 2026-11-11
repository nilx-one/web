// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Attested finds (nilx-one/core `docs/find-attestation.md`). The device keeps
 * the things; Identity attests each pick-up and answers an opaque id, and only
 * that id leaves the device again: to sell the thing, or to use it up in a
 * craft Identity pays for. No request carries an amount.
 *
 * What an answer means is read by Core (`nilxone-api`, through the runtime's
 * `readFindAttestation`, `readFindSale` and `readCraftPayment`): no parser of
 * these bodies lives in Web.
 */

export interface ReportedPickup {
  readonly artifactId: string;
  readonly finder: "bond" | "avaia";
  readonly foundAtMs: number;
  readonly longitude: number;
  readonly latitude: number;
}

export type AttestRefusal =
  | "taken"
  | "unknown_find"
  | "out_of_time"
  | "too_far"
  | "not_the_avaias"
  | "invalid_pickup";

export type AttestResult =
  | {
      readonly kind: "attested";
      readonly attestationId: string;
      readonly itemId: string;
      readonly seedsCredited: bigint;
    }
  | { readonly kind: "refused"; readonly reason: AttestRefusal }
  | { readonly kind: "unavailable" };

export type SaleResult =
  | { readonly kind: "sold"; readonly seedsCredited: bigint }
  | {
      readonly kind: "refused";
      readonly reason: "unknown_attestation" | "not_for_sale" | "used_up";
    }
  | { readonly kind: "unavailable" };

export type CraftPaymentRefusal =
  | "invalid_craft"
  | "not_enough_seeds"
  | "wrong_inputs"
  | "unverifiable_inputs"
  | "conflicting_replay"
  | "unknown_recipe"
  | "inactive";

export type CraftPaymentResult =
  | { readonly kind: "paid"; readonly seedsDebited: bigint }
  | { readonly kind: "refused"; readonly reason: CraftPaymentRefusal }
  | { readonly kind: "unavailable" };

export interface FindAttestationPort {
  attestFind(pickup: ReportedPickup): Promise<AttestResult>;
  sellFind(attestationId: string): Promise<SaleResult>;
  payCraft(
    craftId: string,
    recipe: string,
    inputs: readonly string[],
  ): Promise<CraftPaymentResult>;
}

export function hasFindAttestation(
  value: unknown,
): value is FindAttestationPort {
  if (typeof value !== "object" || value === null) return false;
  const port = value as Partial<FindAttestationPort>;
  return (
    typeof port.attestFind === "function" &&
    typeof port.sellFind === "function" &&
    typeof port.payCraft === "function"
  );
}
