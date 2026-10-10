// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ArtifactId, LonLat } from "./index";
import { mulberry32, xmur3 } from "./random";

/**
 * Orbs: what spills out of a fog cell when it opens, and leads to a find the
 * cell holds.
 *
 * When a Bond's Avaia (or the Bond itself) opens a cell, each find in it
 * spills a short trail of orbs, in small clumps, from the middle of the cell
 * to where the find lies. How many is a public function of the find, five to
 * thirty, the same on every device. The spill itself is the Bond's to tell:
 * it lives thirty minutes and the service is told only which find spilled,
 * so every Bond near enough to roll that find can see the trail too. Anyone
 * who comes within fifteen metres of an orb picks it up for ten experience;
 * the first to reach it gets it, and the rest get "crap!".
 *
 * Like a find, an orb is never a coordinate on the wire: its place is laid
 * here, from the find and the point the trail starts at.
 */

/** What one orb pays whoever picks it up, an Avaia or a Bond. */
export const ORB_EXPERIENCE = 10;

/** How long a spill lies on the ground before it is gone. */
export const ORB_LIFETIME_MS = 30 * 60_000;

/** An orb is picked up from closer than this. */
export const ORB_PICKUP_METERS = 15;

/** The fewest and most orbs one find spills. */
export const ORB_MIN = 5;
export const ORB_MAX = 30;

/** Seeds the count; part of the public contract with the service. */
const ORB_COUNT_DOMAIN = "nilx-one.orbs.v1:";

/** Seeds where the orbs lie; presentation only, never sent. */
const ORB_TRAIL_DOMAIN = "nilx-one.orbs.trail.v1:";

/** The fewest and most orbs in one clump. */
const CLUMP_MIN = 3;
const CLUMP_MAX = 6;

/** How far an orb strays from the middle of its clump. */
const CLUMP_SCATTER_METERS = 3;

/** The last clump stops short of the find, so the find itself stays clear. */
const TRAIL_REACH = 0.88;

const METERS_PER_DEGREE = 111_195;

/** `orb:` and the find, then which of its orbs. */
export type OrbId = `orb:${ArtifactId}:${number}`;

/**
 * How many orbs a find spills, from five to thirty. The service counts the
 * same with the same generator, so a pick-up past the count is refused.
 */
export function orbCount(artifactId: ArtifactId): number {
  const draw = mulberry32(xmur3(`${ORB_COUNT_DOMAIN}${artifactId}`)())();
  return ORB_MIN + Math.floor(draw * (ORB_MAX - ORB_MIN + 1));
}

export function orbId(artifactId: ArtifactId, index: number): OrbId {
  return `orb:${artifactId}:${index}`;
}

const ORB_ID = /^orb:(art:seg:-?\d+:-?\d+:e-?\d+:\d+:\d+):(\d+)$/;

export function isOrbId(value: unknown): value is OrbId {
  return typeof value === "string" && parseOrbId(value) !== undefined;
}

/** The find and the orb an id names, or `undefined` for anything else. */
export function parseOrbId(
  id: string,
): { readonly artifactId: ArtifactId; readonly index: number } | undefined {
  const match = ORB_ID.exec(id);
  if (match === null) return undefined;
  const artifactId = match[1] as ArtifactId;
  const index = Number(match[2]);
  if (String(index) !== match[2] || index >= orbCount(artifactId)) {
    return undefined;
  }
  return { artifactId, index };
}

/** One orb on the ground: which it is, where, and the clump it fell in. */
export interface OrbSpot {
  readonly index: number;
  readonly point: LonLat;
  readonly clump: number;
}

/**
 * Where a find's orbs lie: clumps of three to six, spaced evenly from `from`
 * towards `to` (the find), each orb a few metres from its clump's middle.
 * Orbs are numbered from the start of the trail, so a trail that falls in
 * order falls towards the find.
 */
export function orbTrail(
  artifactId: ArtifactId,
  from: LonLat,
  to: LonLat,
): OrbSpot[] {
  const count = orbCount(artifactId);
  const random = mulberry32(xmur3(`${ORB_TRAIL_DOMAIN}${artifactId}`)());
  const sizes: number[] = [];
  let left = count;
  while (left > 0) {
    let size = CLUMP_MIN + Math.floor(random() * (CLUMP_MAX - CLUMP_MIN + 1));
    // Never leave a remainder too small to be a clump of its own: what fits
    // in one clump is the last one, and otherwise this one gives way.
    if (left - size < CLUMP_MIN) {
      size = left <= CLUMP_MAX ? left : left - CLUMP_MIN;
    }
    sizes.push(size);
    left -= size;
  }

  const [fromLongitude, fromLatitude] = from;
  const [toLongitude, toLatitude] = to;
  const longitudeScale =
    METERS_PER_DEGREE *
    Math.max(0.01, Math.cos((fromLatitude * Math.PI) / 180));
  const spots: OrbSpot[] = [];
  sizes.forEach((size, clump) => {
    const along = (TRAIL_REACH * (clump + 1)) / sizes.length;
    const centerLongitude =
      fromLongitude + (toLongitude - fromLongitude) * along;
    const centerLatitude = fromLatitude + (toLatitude - fromLatitude) * along;
    for (let i = 0; i < size; i++) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * CLUMP_SCATTER_METERS;
      spots.push({
        index: spots.length,
        clump,
        point: [
          centerLongitude + (Math.cos(angle) * distance) / longitudeScale,
          centerLatitude + (Math.sin(angle) * distance) / METERS_PER_DEGREE,
        ],
      });
    }
  });
  return spots;
}
