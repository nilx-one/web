// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAX_CLAIM_BUCKETS,
  type CommitAwardsResult,
  type CommittedAwardAccessPort,
} from "@nilx-one/application";
import {
  bucketsFor,
  closedLeads,
  type ClaimedSet,
  type ClosedLeads,
  type FindLead,
} from "@nilx-one/artifact-contract";

/**
 * Claims on rare finds, as this device lives with them (docs/avaia-outings.md,
 * R3; #304).
 *
 * A pick-up of tier 4 to 6 is pending until the service answers it. What the
 * device does next depends only on that answer, so the same answer always
 * ends the same way, and no answer never ends anything:
 *
 * - `keep`: the find is this Bond's. Write it into the history, move the
 *   chain on, close its lead.
 * - `close-quietly`: another device of this Bond picked it up first. Drop the
 *   pending record, close the lead, say nothing: nothing was lost.
 * - `oh-crap`: another Bond picked it up first. Drop the pending record,
 *   close the lead, and the Avaia says "oh crap! someone got there first".
 * - `drop`: the service refused the award itself (a full week, a chain that
 *   moved on, a malformed award). Drop the pending record; the lead stays.
 * - `wait`: no answer (offline, the service down, rate-limited, signed out).
 *   Keep the pending record and offer it again under the same commitment,
 *   which the service pays at most once. The lead stays open.
 *
 * Tiers 1 to 3 never come here: they are every Bond's own, and their pick-up
 * names no find.
 */
export type PickUpResolution =
  "keep" | "close-quietly" | "oh-crap" | "drop" | "wait";

/** What to do with the pending pick-up committed as `id`, given the answer. */
export function resolvePickUp(
  result: CommitAwardsResult,
  id: string,
): PickUpResolution {
  switch (result.kind) {
    case "service-unavailable":
      return "wait";
    case "rejected":
      return result.reason === "invalid" ? "drop" : "wait";
    case "committed":
      break;
  }
  const outcome = result.results.find((entry) => entry.id === id)?.outcome;
  switch (outcome?.kind) {
    // `duplicate`: paid before under this very commitment, and the earlier
    // answer was lost on the way back.
    case "accepted":
    case "duplicate":
      return "keep";
    case "already-yours":
      return "close-quietly";
    case "taken":
      return "oh-crap";
    case "behind":
    case "capped":
    case "too-many-chains":
      return "drop";
    case undefined:
      return "wait";
  }
}

/**
 * Which of `leads` the week's claims close, matched on this device. The
 * service is asked by sha bucket only, so it hears 1/256 of the week per
 * bucket and never which lead. Any read that fails closes nothing: a lead
 * stays open until an answer says otherwise.
 */
export async function claimedLeads(
  port: CommittedAwardAccessPort,
  leads: readonly FindLead[],
): Promise<ClosedLeads | undefined> {
  if (leads.length === 0) return { taken: [], yours: [] };
  const buckets = await bucketsFor(leads);
  const claimed = new Map<string, "yours" | "theirs">();
  for (let start = 0; start < buckets.length; start += MAX_CLAIM_BUCKETS) {
    const result = await port.readClaims(
      buckets.slice(start, start + MAX_CLAIM_BUCKETS),
    );
    if (result.kind !== "read") return undefined;
    for (const claim of result.claims) {
      claimed.set(claim.sha, claim.yours ? "yours" : "theirs");
    }
  }
  return closedLeads(leads, claimed satisfies ClaimedSet);
}
