// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ArtifactId, FindRoll, Tier } from "./index";

/**
 * Who is paid for a find (R2): whoever did the thing. Seeing a find pays
 * whoever saw it first; picking it up pays whoever picked it up.
 *
 * - The Avaia sees what it walks past, whether it went on its own or was sent
 *   by a tap. The Bond sees what this device itself walks past.
 * - The Avaia picks up the commoner tiers itself. A rarer find it only sees,
 *   and leaves as a lead: the person takes the wheel, walks there and picks it
 *   up, and the pick-up pays the Bond.
 *
 * Experience here is the owner's own report like the rest of progression. It
 * implies no consent, no reciprocity, no Relationship and no BondChain record.
 */
export type FindEarner = "avaia" | "bond";

/** Seeing a find, any tier. */
export const FIND_SEEN_EXPERIENCE = 10;

/** The rarest tier an Avaia picks up itself. Rarer finds wait for the person. */
export const AVAIA_PICKUP_MAX_TIER: Tier = 3;

export type FindEventKind = "seen" | "picked_up";

/** Something that happened to a find, as the device's journal records it. */
export interface FindEvent {
  readonly artifactId: ArtifactId;
  readonly kind: FindEventKind;
  readonly by: FindEarner;
}

export interface FindAward {
  readonly artifactId: ArtifactId;
  readonly kind: FindEventKind;
  readonly earner: FindEarner;
  readonly experience: number;
}

export function canPickUp(roll: FindRoll, by: FindEarner): boolean {
  return by === "bond" || roll.tier <= AVAIA_PICKUP_MAX_TIER;
}

/**
 * What one event pays, given what is already recorded. Each find pays its
 * sighting once and its pick-up once, whoever does it and however often the
 * event repeats, so replaying the journal never mints twice. Picking up a find
 * nobody had seen yet is seeing it too. An Avaia reaching for a find above its
 * tier picks up nothing.
 */
export function awardsFor(
  roll: FindRoll,
  event: { readonly kind: FindEventKind; readonly by: FindEarner },
  recorded: readonly FindEvent[],
): FindAward[] {
  const own = recorded.filter((past) => past.artifactId === roll.artifactId);
  const seen = own.some((past) => past.kind === "seen");
  const pickedUp = own.some((past) => past.kind === "picked_up");
  const sighting: FindAward = {
    artifactId: roll.artifactId,
    kind: "seen",
    earner: event.by,
    experience: FIND_SEEN_EXPERIENCE,
  };
  if (event.kind === "seen") return seen ? [] : [sighting];
  if (pickedUp || !canPickUp(roll, event.by)) return [];
  const pickUp: FindAward = {
    artifactId: roll.artifactId,
    kind: "picked_up",
    earner: event.by,
    experience: roll.experience,
  };
  return seen ? [pickUp] : [sighting, pickUp];
}
