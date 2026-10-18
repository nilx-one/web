// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FlightLootRarity, MapFlightLoot } from "@nilx-one/map-contract";
import type { FlightPath, LocalFrame, Point } from "./flyover-flight";
import { FLYOVER_LANE_METERS, pathAt } from "./flyover-flight";

/** Standard flight: 150 m gives five seconds at 30 m/s. */
export const LOOT_REACTION_SECONDS = 5;
export const LOOT_MIN_VISIBLE_METERS = 150;
/** Rarity glow begins one second before impact at the unforced 30 m/s. */
export const LOOT_NEAR_METERS = 30;
/** Three-dimensional collision radius, including xPing's body and the item. */
export const LOOT_PICKUP_RADIUS_METERS = 3;
/** Two lasers can acquire reachable objects, but never award them. */
export const LOOT_LASER_RANGE_METERS = 45;
/** Post-contact 3D intake lasts a quarter of a second. */
export const LOOT_INTAKE_MS = 250;

export type FlightLootKind = MapFlightLoot["kind"];

/**
 * A layout input from an authorized producer, not a local drop roll.
 * The distance and lane are relative to the outbound road flight path.
 */
export interface FlightLootSpawn {
  readonly id: string;
  readonly distanceMeters: number;
  readonly lane: -2 | -1 | 0 | 1 | 2;
  readonly heightMeters: number;
  readonly kind: FlightLootKind;
  readonly rarity: FlightLootRarity;
}

export const RARITY_RANK: Readonly<Record<FlightLootRarity, number>> = {
  common: 1,
  uncommon: 2,
  rare: 3,
  special: 4,
  exclusive: 5,
};

export function rarerLoot(
  previous: FlightLootRarity | undefined,
  collected: FlightLootRarity,
): FlightLootRarity {
  return previous === undefined ||
    RARITY_RANK[collected] > RARITY_RANK[previous]
    ? collected
    : previous;
}

/** A rigid world-space point in the same local metric frame as xPing. */
export function lootPosition(path: FlightPath, item: FlightLootSpawn): Point {
  const { point, direction } = pathAt(path, item.distanceMeters);
  const offset = item.lane * FLYOVER_LANE_METERS;
  return [
    point[0] + direction[1] * offset,
    point[1] - direction[0] * offset,
  ];
}

/**
 * Show shapes with a useful reaction window; reserve strong emission for the
 * last 30 metres of *route* distance, not a wall-clock timeout. Forced flight
 * expands the preview horizon without expanding the near-glow distance.
 */
export function visibleFlightLoot(
  path: FlightPath,
  frame: LocalFrame,
  spawns: readonly FlightLootSpawn[],
  distanceMeters: number,
  speedMps: number,
  alreadyCollected: ReadonlySet<string>,
): MapFlightLoot[] {
  const horizon = Math.max(
    LOOT_MIN_VISIBLE_METERS,
    Math.max(0, speedMps) * LOOT_REACTION_SECONDS,
  );
  return spawns.flatMap((item) => {
    const ahead = item.distanceMeters - distanceMeters;
    if (
      alreadyCollected.has(item.id) ||
      ahead < -LOOT_PICKUP_RADIUS_METERS ||
      ahead > horizon
    )
      return [];
    const [longitude, latitude] = frame.toLonLat(lootPosition(path, item));
    return [
      {
        id: item.id,
        lngLat: [longitude, latitude] as const,
        heightMeters: item.heightMeters,
        kind: item.kind,
        rarity: item.rarity,
        near: ahead >= 0 && ahead <= LOOT_NEAR_METERS,
      },
    ];
  });
}

/**
 * Continuous point-to-segment check in metres: frame drops and boost cannot
 * tunnel through an orb, and changing lanes still requires actual contact.
 */
export function crossedFlightLoot(
  path: FlightPath,
  item: FlightLootSpawn,
  previous: readonly [x: number, y: number, height: number],
  current: readonly [x: number, y: number, height: number],
): boolean {
  const [x, y] = lootPosition(path, item);
  const target = [x, y, item.heightMeters];
  const delta = current.map((value, index) => value - previous[index]!);
  const squared = delta.reduce((sum, value) => sum + value * value, 0);
  const t =
    squared <= 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            delta.reduce(
              (sum, value, index) =>
                sum + (target[index]! - previous[index]!) * value,
              0,
            ) / squared,
          ),
        );
  const separationSquared = previous.reduce((sum, value, index) => {
    const offset = target[index]! - (value + t * delta[index]!);
    return sum + offset * offset;
  }, 0);
  return separationSquared <= LOOT_PICKUP_RADIUS_METERS ** 2;
}

/**
 * Only targets in front of xPing and in three-dimensional reach may receive
 * a laser. A stable ID breaks equal-distance ties. No pickup is implied.
 */
export function laserLootTargets(
  path: FlightPath,
  spawns: readonly FlightLootSpawn[],
  distanceMeters: number,
  point: readonly [x: number, y: number, height: number],
  alreadyCollected: ReadonlySet<string>,
): string[] {
  return spawns
    .filter(
      (item) =>
        !alreadyCollected.has(item.id) &&
        item.distanceMeters >= distanceMeters - LOOT_PICKUP_RADIUS_METERS,
    )
    .map((item) => {
      const [x, y] = lootPosition(path, item);
      return {
        id: item.id,
        distance: Math.hypot(
          x - point[0],
          y - point[1],
          item.heightMeters - point[2],
        ),
      };
    })
    .filter(({ distance }) => distance <= LOOT_LASER_RANGE_METERS)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map(({ id }) => id);
}

/** Ignore malformed and duplicate display spawns rather than generating wins. */
export function validFlightLoot(
  spawns: readonly FlightLootSpawn[],
  routeLength: number,
): FlightLootSpawn[] {
  const seen = new Set<string>();
  return spawns.filter((item) => {
    if (
      !item.id ||
      seen.has(item.id) ||
      !Number.isFinite(item.distanceMeters) ||
      !(item.distanceMeters > 0 && item.distanceMeters < routeLength) ||
      !Number.isInteger(item.lane) ||
      Math.abs(item.lane) > 2 ||
      !Number.isFinite(item.heightMeters) ||
      item.heightMeters < 0 ||
      item.heightMeters > 300 ||
      !["orb", "seeds", "balloon", "cell", "cosmetic"].includes(item.kind) ||
      !(item.rarity in RARITY_RANK)
    )
      return false;
    seen.add(item.id);
    return true;
  });
}
