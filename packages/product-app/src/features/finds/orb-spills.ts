// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  OrbCoordinate,
  OrbSpillView,
  OrbWorldInput,
  OrbWorldView,
} from "@nilx-one/application";
import {
  epochOf,
  FIND_PACK_ID,
  findPoint,
  rollSegment,
  ROLL_TABLE,
  segmentsWithin,
  type ArtifactId,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import type { MapOrb, MapPointSelection } from "@nilx-one/map-contract";

/**
 * Orb spills as this device holds them. Every orb rule is Core's
 * (`orb_world`, nilx-one/core `docs/orb-spills.md`): how many, where, when
 * each lands, how long a spill lives, what is within reach. This module only
 * keeps what the service answered and translates between the map's degrees
 * and Core's wire.
 */
export interface KnownSpill {
  readonly artifactId: ArtifactId;
  readonly sha: string;
  readonly count: number;
  /** Wall-clock milliseconds the service says the spill is gone at. */
  readonly expiresAt: number;
  /** Orbs someone has picked up already, as the service last answered. */
  readonly taken: readonly number[];
  /** Where the trail starts: the middle of the cell the find lies in. */
  readonly from: LonLat;
  /** The find the trail leads to. */
  readonly to: LonLat;
  /** When this device first drew it, so its orbs fall once, then lie. */
  readonly appearedAt: number;
}

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

/** Degrees as Core's E7 decimal strings. */
export function toCoordinate([longitude, latitude]: LonLat): OrbCoordinate {
  const e7 = (degrees: number) => String(Math.round(degrees * 1e7) || 0);
  return { longitude_e7: e7(longitude), latitude_e7: e7(latitude) };
}

/** Core's E7 decimal strings as degrees. */
export function fromCoordinate(at: OrbCoordinate): LonLat {
  return [Number(at.longitude_e7) / 1e7, Number(at.latitude_e7) / 1e7];
}

/** A spill as the service answered it, for a find this device rolled. */
export function knownSpill(
  view: OrbSpillView,
  roll: Pick<FindRoll, "artifactId" | "segment" | "placement">,
  cellCenter: (point: LonLat) => LonLat | undefined,
  appearedAt: number,
): KnownSpill {
  const to = findPoint(roll);
  return {
    artifactId: roll.artifactId,
    sha: view.sha,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: [...view.taken],
    from: cellCenter(to) ?? to,
    to,
    appearedAt,
  };
}

/** A newer answer for a spill already drawn: who took what, nothing else. */
export function refreshSpill(
  spill: KnownSpill,
  view: OrbSpillView,
): KnownSpill {
  return {
    ...spill,
    count: view.count,
    expiresAt: view.expiresAt,
    taken: [...view.taken],
  };
}

/** What Core is asked: the spills, this device's pick-ups, and who stands where. */
export function orbWorldInput(
  spills: readonly KnownSpill[],
  picked: ReadonlySet<string>,
  bond: MapPointSelection | undefined,
  avaia: MapPointSelection | undefined,
): OrbWorldInput {
  const at = (point: MapPointSelection | undefined) =>
    point === undefined
      ? null
      : toCoordinate([point.longitude, point.latitude]);
  return {
    spills: spills.map((spill) => ({
      artifact_id: spill.artifactId,
      from: toCoordinate(spill.from),
      to: toCoordinate(spill.to),
      appeared_at: String(Math.max(0, Math.trunc(spill.appearedAt))),
      expires_at: String(Math.max(0, Math.trunc(spill.expiresAt))),
      count: spill.count,
      taken: [...spill.taken],
    })),
    picked: [...picked],
    bond: at(bond),
    avaia: at(avaia),
  };
}

/** What the world draws, exactly as Core laid it. */
export function mapOrbs(view: OrbWorldView): MapOrb[] {
  return view.orbs.map((orb) => {
    const [longitude, latitude] = fromCoordinate(orb.at);
    return {
      id: orb.id,
      longitude,
      latitude,
      kind: orb.kind,
      landsAt: Number(orb.lands_at),
    };
  });
}
