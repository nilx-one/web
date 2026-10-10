// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { OrbSpillView } from "@nilx-one/application";
import {
  epochOf,
  FIND_PACK_ID,
  findPoint,
  ORB_PICKUP_METERS,
  orbId,
  orbTrail,
  rollSegment,
  ROLL_TABLE,
  segmentsWithin,
  type ArtifactId,
  type FindRoll,
  type LonLat,
  type OrbId,
} from "@nilx-one/artifact-contract";
import {
  mapDistanceMeters,
  type MapOrb,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * Orb spills as this device lives with them (artifact-contract `orbs.ts`).
 *
 * A spill is known here once the service has answered it: the Bond that
 * opened the cell told it, or a read around this Bond found it. Where each
 * orb lies is laid on this device from the find alone, so the service never
 * hears a place.
 */
export interface LiveSpill {
  readonly artifactId: ArtifactId;
  readonly sha: string;
  readonly count: number;
  /** Wall-clock milliseconds the spill is gone at. */
  readonly expiresAt: number;
  /** Orbs someone has picked up already, as the service last answered. */
  readonly taken: ReadonlySet<number>;
  /** Where the trail starts: the middle of the cell the find lies in. */
  readonly from: LonLat;
  /** The find the trail leads to. */
  readonly to: LonLat;
  /** When this device first drew it, so its orbs fall once, then lie. */
  readonly appearedAt: number;
}

/** How far apart, in time, the orbs of one trail land: a trickle, not a dump. */
export const ORB_STAGGER_MS = 70;

/** A trail shorter than this is stretched back, so its clumps do not pile up. */
export const MIN_TRAIL_METERS = 30;

/** How far around a Bond the spills of its finds are read. */
export const SPILL_READ_RADIUS_METERS = 450;

const METERS_PER_DEGREE = 111_195;

/** The finds a ring holds this week, by the public roll. */
export function findsWithin(
  ring: readonly (readonly [number, number])[],
  nowMs: number,
): FindRoll[] {
  const epoch = epochOf(nowMs);
  return segmentsWithin(ring).flatMap((segment) => {
    const roll = rollSegment({
      packId: FIND_PACK_ID,
      packVersion: ROLL_TABLE.version,
      epoch,
      segment,
    });
    return roll === null ? [] : [roll];
  });
}

/** A square ring `radius` metres to each side of a point. */
export function squareAround(
  point: MapPointSelection,
  radiusMeters: number,
): readonly (readonly [number, number])[] {
  const dLat = radiusMeters / METERS_PER_DEGREE;
  const dLng =
    radiusMeters /
    (METERS_PER_DEGREE *
      Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180)));
  const { longitude: x, latitude: y } = point;
  return [
    [x - dLng, y - dLat],
    [x + dLng, y - dLat],
    [x + dLng, y + dLat],
    [x - dLng, y + dLat],
  ];
}

/**
 * Where a trail to `to` starts: `from`, unless that is too close to make a
 * trail of, in which case the same way back, `MIN_TRAIL_METERS` from the find.
 */
export function trailStart(from: LonLat, to: LonLat): LonLat {
  const scale =
    METERS_PER_DEGREE * Math.max(0.01, Math.cos((to[1] * Math.PI) / 180));
  const dx = (from[0] - to[0]) * scale;
  const dy = (from[1] - to[1]) * METERS_PER_DEGREE;
  const length = Math.hypot(dx, dy);
  if (length >= MIN_TRAIL_METERS) return from;
  // Straight at the find, or nowhere at all: come in from the south-west.
  const [ux, uy] =
    length < 1e-6 ? [-Math.SQRT1_2, -Math.SQRT1_2] : [dx / length, dy / length];
  return [
    to[0] + (ux * MIN_TRAIL_METERS) / scale,
    to[1] + (uy * MIN_TRAIL_METERS) / METERS_PER_DEGREE,
  ];
}

/** A spill as the service answered it, laid out for a find this device rolled. */
export function liveSpill(
  view: OrbSpillView,
  roll: Pick<FindRoll, "artifactId" | "segment" | "placement">,
  cellCenter: (point: LonLat) => LonLat | undefined,
  appearedAt: number,
): LiveSpill {
  const to = findPoint(roll);
  return {
    artifactId: roll.artifactId,
    sha: view.sha,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: new Set(view.taken),
    from: trailStart(cellCenter(to) ?? to, to),
    to,
    appearedAt,
  };
}

/** A newer answer for a spill already drawn: who took what, nothing else. */
export function refreshSpill(spill: LiveSpill, view: OrbSpillView): LiveSpill {
  return {
    ...spill,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: new Set(view.taken),
  };
}

export interface LyingOrb {
  readonly id: OrbId;
  readonly point: LonLat;
  readonly landsAt: number;
}

/**
 * The orbs of a spill still on the ground at `nowMs`: none once it is gone,
 * and none someone took or this device picked up.
 */
export function lyingOrbs(
  spill: LiveSpill,
  picked: ReadonlySet<string>,
  nowMs: number,
): LyingOrb[] {
  if (nowMs >= spill.expiresAt) return [];
  return orbTrail(spill.artifactId, spill.from, spill.to).flatMap((spot) => {
    if (spot.index >= spill.count || spill.taken.has(spot.index)) return [];
    const id = orbId(spill.artifactId, spot.index);
    if (picked.has(id)) return [];
    return [
      {
        id,
        point: spot.point,
        landsAt: spill.appearedAt + (spot.index + 1) * ORB_STAGGER_MS,
      },
    ];
  });
}

/** What the world draws: every lying orb, and the find each trail leads to. */
export function mapOrbs(
  spills: readonly LiveSpill[],
  picked: ReadonlySet<string>,
  nowMs: number,
): MapOrb[] {
  return spills.flatMap((spill) => {
    const lying = lyingOrbs(spill, picked, nowMs);
    if (lying.length === 0) return [];
    return [
      ...lying.map((orb): MapOrb => ({
        id: orb.id,
        longitude: orb.point[0],
        latitude: orb.point[1],
        kind: "orb",
        landsAt: orb.landsAt,
      })),
      {
        id: `goal:${spill.artifactId}`,
        longitude: spill.to[0],
        latitude: spill.to[1],
        kind: "goal",
        landsAt: spill.appearedAt + (spill.count + 2) * ORB_STAGGER_MS,
      },
    ];
  });
}

/** The lying orbs within reach of `point`, nearest first. */
export function orbsInReach(
  spills: readonly LiveSpill[],
  picked: ReadonlySet<string>,
  point: MapPointSelection,
  nowMs: number,
): OrbId[] {
  return spills
    .flatMap((spill) => lyingOrbs(spill, picked, nowMs))
    .map((orb) => ({
      id: orb.id,
      meters: mapDistanceMeters(point, {
        longitude: orb.point[0],
        latitude: orb.point[1],
      }),
    }))
    .filter((orb) => orb.meters < ORB_PICKUP_METERS)
    .sort((a, b) => a.meters - b.meters)
    .map((orb) => orb.id);
}
