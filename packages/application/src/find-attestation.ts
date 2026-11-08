// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Attested finds (nilx-one/core `docs/find-attestation.md`). The device keeps
 * the things; Identity attests each pick-up and answers an opaque id, and only
 * that id leaves the device again: to sell the thing, or to use it up in a
 * craft Identity pays for. No request carries an amount.
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

const ATTEST_REFUSALS: readonly AttestRefusal[] = [
  "taken",
  "unknown_find",
  "out_of_time",
  "too_far",
  "not_the_avaias",
  "invalid_pickup",
];
const CRAFT_REFUSALS: readonly CraftPaymentRefusal[] = [
  "not_enough_seeds",
  "wrong_inputs",
  "unverifiable_inputs",
  "conflicting_replay",
  "unknown_recipe",
];
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DECIMAL = /^(0|[1-9]\d{0,18})$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCode(body: unknown): string | undefined {
  const code = record(record(body)?.error)?.code;
  return typeof code === "string" ? code : undefined;
}

function amount(value: unknown): bigint | undefined {
  return typeof value === "string" && DECIMAL.test(value)
    ? BigInt(value)
    : undefined;
}

/** Reads `POST /api/v1/identity/finds/attest`'s answer strictly. */
export function parseAttestAnswer(ok: boolean, body: unknown): AttestResult {
  if (!ok) {
    const code = errorCode(body);
    return ATTEST_REFUSALS.includes(code as AttestRefusal)
      ? { kind: "refused", reason: code as AttestRefusal }
      : { kind: "unavailable" };
  }
  const answer = record(body);
  const credited = amount(answer?.seeds_credited);
  if (
    (answer?.outcome !== "attested" && answer?.outcome !== "already_yours") ||
    typeof answer.attestation_id !== "string" ||
    !UUID.test(answer.attestation_id) ||
    typeof answer.item_id !== "string" ||
    !/^[a-z0-9_]{1,64}$/.test(answer.item_id) ||
    credited === undefined
  )
    return { kind: "unavailable" };
  return {
    kind: "attested",
    attestationId: answer.attestation_id,
    itemId: answer.item_id,
    seedsCredited: credited,
  };
}

/** Reads `POST /api/v1/identity/finds/sell`'s answer strictly. */
export function parseSaleAnswer(ok: boolean, body: unknown): SaleResult {
  if (!ok) {
    const code = errorCode(body);
    return code === "unknown_attestation" ||
      code === "not_for_sale" ||
      code === "used_up"
      ? { kind: "refused", reason: code }
      : { kind: "unavailable" };
  }
  const answer = record(body);
  const credited = amount(answer?.seeds_credited);
  return (answer?.outcome === "sold" || answer?.outcome === "already_sold") &&
    credited !== undefined
    ? { kind: "sold", seedsCredited: credited }
    : { kind: "unavailable" };
}

/** Reads `POST /api/v1/identity/crafts`'s answer strictly. */
export function parseCraftAnswer(
  ok: boolean,
  body: unknown,
): CraftPaymentResult {
  if (!ok) {
    const code = errorCode(body);
    if (code === "session_inactive")
      return { kind: "refused", reason: "inactive" };
    return CRAFT_REFUSALS.includes(code as CraftPaymentRefusal)
      ? { kind: "refused", reason: code as CraftPaymentRefusal }
      : { kind: "unavailable" };
  }
  const answer = record(body);
  const debited = amount(answer?.seeds_debited);
  return (answer?.outcome === "started" ||
    answer?.outcome === "already_started") &&
    debited !== undefined
    ? { kind: "paid", seedsDebited: debited }
    : { kind: "unavailable" };
}
