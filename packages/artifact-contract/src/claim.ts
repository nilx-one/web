// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FindLead } from "./leads";
import type { ArtifactId, Tier } from "./index";

/**
 * Claims: one rare find, one Bond (docs/avaia-outings.md, R3; #304).
 *
 * Every client rolls the same find on the same segment and week, so nothing
 * has to be shared for everyone to see it. What is shared is who got it: the
 * first Bond to pick up a rare find claims its `artifactSha` on the server,
 * and anyone after gets "oh crap!".
 *
 * An `artifactSha` is public by design: anyone can compute it from the
 * `artifactId`, and every `artifactId` of a week can be enumerated. It names
 * the artifact, never the person. Who picked it up is the server's claim
 * table, never this sha.
 */

/** Every `artifactSha` is the SHA-256 of this prefix and the `artifactId`. */
export const ARTIFACT_SHA_DOMAIN = "nilx-one.artifact.v1:";

/** The commonest tier that is claimed. Commoner finds are every Bond's own. */
export const CLAIMED_MIN_TIER: Tier = 4;

/** 64 lowercase hex digits. */
export type ArtifactSha = string & { readonly __artifactSha: true };

const ARTIFACT_SHA = /^[0-9a-f]{64}$/;

export function isArtifactSha(value: unknown): value is ArtifactSha {
  return typeof value === "string" && ARTIFACT_SHA.test(value);
}

/** Whether picking up a find of this tier has to claim it first. */
export function isClaimed(tier: Tier): boolean {
  return tier >= CLAIMED_MIN_TIER;
}

/** The public name of a find: the same on every device, for every Bond. */
export async function artifactSha(id: ArtifactId): Promise<ArtifactSha> {
  const bytes = new TextEncoder().encode(`${ARTIFACT_SHA_DOMAIN}${id}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(digest)) as ArtifactSha;
}

/**
 * What the server answered a pick-up of a claimed find:
 *
 * - `claimed`: this Bond is the first; the find and its award are kept;
 * - `already_yours`: another device of this Bond got it first; nothing pays
 *   twice, but this is no loss either;
 * - `taken`: another Bond got it first. Oh crap.
 */
export type ClaimOutcome = "claimed" | "already_yours" | "taken";

/**
 * Claims of one week, as the server answers them for the buckets asked: each
 * claimed find, and whether this Bond is the one that claimed it. It names no
 * other Bond. A find whose bucket was not asked is simply absent.
 */
export type ClaimedSet = ReadonlyMap<string, "yours" | "theirs">;

/**
 * Which of 256 buckets a find's claim is answered in: the first byte of its
 * `artifactSha`, as two hex digits. Asking by bucket names 1/256 of a week's
 * claims, never a lead.
 */
export function claimBucket(sha: ArtifactSha): string {
  return sha.slice(0, 2);
}

/** The buckets to ask for to hear about these leads, sorted, each once. */
export async function bucketsFor(
  leads: readonly FindLead[],
): Promise<string[]> {
  const buckets = new Set<string>();
  for (const lead of leads) {
    buckets.add(claimBucket(await artifactSha(lead.artifactId)));
  }
  return [...buckets].sort();
}

/** Leads the claimed set closes, sorted by who got there. */
export interface ClosedLeads {
  /** Another Bond picked these up first. Oh crap. */
  readonly taken: FindLead[];
  /** Another device of this Bond picked these up. Nothing lost. */
  readonly yours: FindLead[];
}

/** Matches leads against a week's claimed set, on this device. */
export async function closedLeads(
  leads: readonly FindLead[],
  claimed: ClaimedSet,
): Promise<ClosedLeads> {
  const taken: FindLead[] = [];
  const yours: FindLead[] = [];
  if (claimed.size === 0) return { taken, yours };
  for (const lead of leads) {
    const by = claimed.get(await artifactSha(lead.artifactId));
    if (by === "theirs") taken.push(lead);
    else if (by === "yours") yours.push(lead);
  }
  return { taken, yours };
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}
