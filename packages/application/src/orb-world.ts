// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Core's orb world (`orb_world` in nilx-one/core, `docs/orb-spills.md`), as
 * its wire names it. Core owns every orb rule: how many a find spills, where
 * each lies, when it lands, how long a spill lives and what is within reach.
 * A host only hands in what it knows and draws what Core answers. Times and
 * coordinates are decimal strings, as Core's contract requires.
 */

/** A point in E7 degrees, as canonical decimal strings. */
export interface OrbCoordinate {
  readonly longitude_e7: string;
  readonly latitude_e7: string;
}

/** One spill as this host knows it. */
export interface OrbWorldSpill {
  readonly artifact_id: string;
  /** Where the trail starts: the middle of the cell the find lies in. */
  readonly from: OrbCoordinate;
  /** Where the find lies. */
  readonly to: OrbCoordinate;
  /** When this device first drew the spill. */
  readonly appeared_at: string;
  readonly expires_at: string;
  /** The claiming service's answer. */
  readonly count: number;
  readonly taken: readonly number[];
}

export interface OrbWorldInput {
  readonly spills: readonly OrbWorldSpill[];
  /** Orb ids this device already picked up. */
  readonly picked: readonly string[];
  /** The Bond's own observation, only while it may pick up. */
  readonly bond: OrbCoordinate | null;
  /** The Avaia's body, only while it walks the world. */
  readonly avaia: OrbCoordinate | null;
}

export interface OrbWorldOrb {
  readonly id: string;
  readonly kind: "orb" | "goal";
  readonly at: OrbCoordinate;
  readonly lands_at: string;
}

export interface OrbWorldView {
  readonly orbs: readonly OrbWorldOrb[];
  /** Orb ids the Bond reaches now, nearest first. */
  readonly bond_reach: readonly string[];
  /** Orb ids the Avaia reaches now, nearest first. */
  readonly avaia_reach: readonly string[];
  /** When the soonest live spill is gone. */
  readonly next_expiry: string | null;
}
