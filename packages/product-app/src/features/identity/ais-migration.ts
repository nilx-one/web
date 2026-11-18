// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Moving an existing Bond to aiaiaiai Identity.
 *
 * The owner proves the Bond with a fresh password sign-in, proves the aiaiaiai
 * account at aiaiaiai itself, and confirms explicitly; the host and Core do
 * the rest in one transaction. Nothing here matches by name: the Bond is the
 * one behind the native session and the account is the one aiaiaiai verified.
 */

const START = "/api/v1/auth/aiaiaiai/migrate/start";
const CONFIRM = "/api/v1/auth/aiaiaiai/migrate/confirm";

/** Why a step of the move did not go through. */
export type AisMigrationFailure =
  | "fresh-sign-in-required"
  | "already-attached"
  | "already-aiaiaiai"
  | "in-progress"
  | "expired"
  | "proof-invalid"
  | "identity-conflict"
  | "unavailable";

export type AisMigrationStart =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "failed"; readonly reason: AisMigrationFailure };

export type AisMigrationConfirm =
  | { readonly kind: "attached"; readonly next: string }
  | { readonly kind: "failed"; readonly reason: AisMigrationFailure };

/** What the page was opened with after the trip to aiaiaiai. */
export type AisMigrationReturn =
  | { readonly stage: "confirm" }
  | { readonly stage: "error"; readonly reason: AisMigrationFailure };

type Fetcher = typeof globalThis.fetch;

const CODES: Readonly<Record<string, AisMigrationFailure>> = {
  fresh_bond_sign_in_required: "fresh-sign-in-required",
  bond_already_attached: "already-attached",
  already_aiaiaiai: "already-aiaiaiai",
  migration_pending: "in-progress",
  migration_expired: "expired",
  aiaiaiai_proof_invalid: "proof-invalid",
  identity_conflict: "identity-conflict",
};

function failureOf(code: unknown): AisMigrationFailure {
  return (typeof code === "string" ? CODES[code] : undefined) ?? "unavailable";
}

async function post(fetcher: Fetcher, path: string): Promise<unknown> {
  const response = await fetcher(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-0x1-csrf": "1" },
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { ok: response.ok, body };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function errorCode(body: unknown): unknown {
  return record(record(body)?.["error"])?.["code"];
}

/** Only a same-origin path may be followed after the move. */
function samePath(value: unknown): string {
  return typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    value.length <= 512
    ? value
    : "/";
}

/** Begins the move; on success the browser goes to aiaiaiai to prove the account. */
export async function startAisMigration(
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<AisMigrationStart> {
  try {
    const answer = record(await post(fetcher, START));
    const body = record(answer?.["body"]);
    const url = body?.["authorization_url"];
    if (answer?.["ok"] === true && typeof url === "string") {
      // Only the issuer's own https origin is a place to send a password to.
      const target = new URL(url, window.location.origin);
      if (
        target.protocol === "https:" ||
        target.origin === window.location.origin
      ) {
        return { kind: "redirect", url: target.toString() };
      }
      return { kind: "failed", reason: "unavailable" };
    }
    return { kind: "failed", reason: failureOf(errorCode(answer?.["body"])) };
  } catch {
    return { kind: "failed", reason: "unavailable" };
  }
}

/** The owner's explicit confirmation; Core attaches the Bond atomically. */
export async function confirmAisMigration(
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
): Promise<AisMigrationConfirm> {
  try {
    const answer = record(await post(fetcher, CONFIRM));
    const body = record(answer?.["body"]);
    if (answer?.["ok"] === true && body?.["attached"] === true) {
      return { kind: "attached", next: samePath(body["next"]) };
    }
    return { kind: "failed", reason: failureOf(errorCode(answer?.["body"])) };
  } catch {
    return { kind: "failed", reason: "unavailable" };
  }
}

/** Reads what the host's callback left in the address after the trip. */
export function readAisMigrationReturn(
  search: string,
): AisMigrationReturn | undefined {
  const params = new URLSearchParams(search);
  if (params.get("migration") === "confirm") return { stage: "confirm" };
  const error = params.get("migration_error");
  if (error === null || error === "") return undefined;
  return {
    stage: "error",
    reason:
      error === "migration_unavailable" ? "unavailable" : failureOf(error),
  };
}
