// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AmbientAnimalClipOf,
  AmbientAnimalHandle,
  AmbientAnimalKind,
} from "@nilx-one/map-contract";
import type { LonLat } from "@nilx-one/walk-graph";

import {
  hashInts,
  metersBetween,
  offsetMeters,
  unitHash,
} from "../ambient-drones/ambient-drone-schedule";
import { insidePolygon } from "../map/avaia-route";

/**
 * Where the city's animals are, as a function of the clock and of the ground
 * the map paints (docs/ambient-animals.md).
 *
 * The world is cut into small cells on a fixed grid. Each cell holds a few
 * spots, a hash of the cell alone. What lives at a spot follows from the
 * ground under it: squirrels where it is green, piranhas in water, dogs and
 * cats along footways and paths, and nothing inside a building. Every animal
 * wanders around its spot through waypoints that are a hash of the animal
 * and the slot's number, so like the drones it is never simulated: where it
 * is at a moment is computed from that moment.
 *
 * The ground comes from the tiles this device has loaded. Two devices with
 * the same tiles see the same animals in the same places.
 */

/** Side of a grid cell. */
export const ANIMAL_CELL_METERS = 40;
const SPOTS_PER_CELL = 2;
/** One slot: a move to the next waypoint, then a rest there. */
export const ANIMAL_SLOT_MS = 9_000;
/** Below this zoom an animal is a dot; none is drawn and nothing runs. */
export const ANIMAL_MIN_ZOOM = 17;
/** The most animals on the ground at once, nearest first. */
export const ANIMAL_MAX_ON_GROUND = 24;
/** How far from a footway's centre line a dog or a cat still walks it. */
export const PATH_REACH_METERS = 10;

/** Eagles keep cells of their own, as wide as a drone's. */
export const EAGLE_CELL_METERS = 600;
/** The share of eagle cells with an eagle circling over them. */
export const EAGLE_SHARE = 0.3;

const METERS_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

/** What the ground under a spot is, as far as an animal cares. */
export type AnimalHabitat = "green" | "water" | "path";

/** The animals that live on the ground (or in the water), not the sky. */
export type GroundAnimalKind = Exclude<AmbientAnimalKind, "eagle">;

type Ring = readonly (readonly [number, number])[];
type Polygon = readonly Ring[];

/** The ground around the camera, from the tiles this device has loaded. */
export interface AnimalGround {
  readonly green: readonly Polygon[];
  readonly water: readonly Polygon[];
  readonly buildings: readonly Polygon[];
  /** Footways and paths, as lines. */
  readonly paths: readonly Ring[];
}

export const EMPTY_GROUND: AnimalGround = {
  green: [],
  water: [],
  buildings: [],
  paths: [],
};

/**
 * How likely a spot of each ground is to keep each animal. The rest of the
 * spots are empty: most of a park is grass with nobody on it.
 */
export const ANIMAL_FREQUENCY: Readonly<
  Record<AnimalHabitat, readonly (readonly [GroundAnimalKind, number])[]>
> = {
  green: [
    ["squirrel", 0.22],
    ["dog", 0.05],
    ["cat", 0.03],
  ],
  water: [["piranha", 0.12]],
  path: [
    ["dog", 0.05],
    ["cat", 0.04],
  ],
};

interface Gait<K extends GroundAnimalKind> {
  /** Ground speed while it moves, metres a second. */
  readonly speed: number;
  /** How far from its spot it wanders. */
  readonly wanderMeters: number;
  readonly move: AmbientAnimalClipOf<K>;
  /** What it does once it gets there, and how often each. */
  readonly rest: readonly [
    readonly [AmbientAnimalClipOf<K>, number],
    ...(readonly [AmbientAnimalClipOf<K>, number])[],
  ];
}

/** Each animal's way of moving about, in the clips its own kind carries. */
const GAITS: { readonly [K in GroundAnimalKind]: Gait<K> } = {
  dog: { speed: 1.2, wanderMeters: 10, move: "walk", rest: [["idle", 1]] },
  cat: { speed: 0.8, wanderMeters: 7, move: "walk", rest: [["idle", 1]] },
  squirrel: {
    speed: 2.5,
    wanderMeters: 6,
    move: "run",
    rest: [
      ["eat", 0.5],
      ["idle", 0.5],
    ],
  },
  piranha: {
    speed: 0.6,
    wanderMeters: 5,
    move: "swim",
    rest: [
      ["swim", 0.7],
      ["bite", 0.3],
    ],
  },
};

/** Clip lengths, read off the assets (`assets/animals/README.md`). */
export const ANIMAL_CLIP_SECONDS: {
  readonly [K in AmbientAnimalKind]: Readonly<
    Record<AmbientAnimalClipOf<K>, number>
  >;
} = {
  dog: { idle: 1.708, walk: 1.708 },
  cat: { idle: 1.708, walk: 1.708 },
  eagle: { fly: 1.25, idle: 1.708 },
  piranha: { swim: 1.667, bite: 1.667 },
  squirrel: { idle: 2, run: 0.5, eat: 2 },
};

export interface AnimalSpec {
  /** Stable for the cell and the spot in it. */
  readonly id: string;
  readonly kind: GroundAnimalKind;
  readonly habitat: AnimalHabitat;
  readonly seed: number;
  readonly home: LonLat;
  /** Shifts its slots against its neighbours', so they never move in step. */
  readonly offsetMs: number;
}

export interface EagleSpec {
  readonly id: string;
  readonly seed: number;
  readonly hub: LonLat;
  readonly ringMeters: number;
  readonly heightMeters: number;
  readonly startAngle: number;
  /** Signed: which way round it circles, radians a second. */
  readonly turnRate: number;
}

interface Cell {
  readonly row: number;
  readonly column: number;
}

function cellDegrees(meters: number): number {
  return meters / METERS_PER_DEGREE;
}

/** A row is a band of latitude, its cells square at the band's middle. */
function longitudeStep(row: number, meters: number): number {
  const latitude = (row + 0.5) * cellDegrees(meters);
  return cellDegrees(meters) / Math.max(0.05, Math.cos(latitude * RAD));
}

function cellOf([longitude, latitude]: LonLat, meters: number): Cell {
  const row = Math.floor(latitude / cellDegrees(meters));
  return { row, column: Math.floor(longitude / longitudeStep(row, meters)) };
}

function cellsAround(
  point: LonLat,
  radiusMeters: number,
  meters: number,
): readonly { cell: Cell; west: number; south: number }[] {
  const reach = Math.ceil(radiusMeters / meters) + 1;
  const home = cellOf(point, meters);
  const cells: { cell: Cell; west: number; south: number }[] = [];
  for (let row = home.row - reach; row <= home.row + reach; row++) {
    const step = longitudeStep(row, meters);
    const column = Math.floor(point[0] / step);
    for (let at = column - reach - 1; at <= column + reach + 1; at++) {
      cells.push({
        cell: { row, column: at },
        west: at * step,
        south: row * cellDegrees(meters),
      });
    }
  }
  return cells;
}

/** Metres from a point to a polyline, on a plane exact enough for a park. */
function metersToLine(point: LonLat, line: Ring): number {
  const kx = METERS_PER_DEGREE * Math.cos(point[1] * RAD);
  const ky = METERS_PER_DEGREE;
  let best = Infinity;
  for (let index = 1; index < line.length; index++) {
    const [ax, ay] = line[index - 1]!;
    const [bx, by] = line[index]!;
    const x1 = (ax - point[0]) * kx;
    const y1 = (ay - point[1]) * ky;
    const x2 = (bx - point[0]) * kx;
    const y2 = (by - point[1]) * ky;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.min(1, Math.max(0, -(x1 * dx + y1 * dy) / length));
    best = Math.min(best, Math.hypot(x1 + t * dx, y1 + t * dy));
  }
  return best;
}

function inside(point: LonLat, polygons: readonly Polygon[]): boolean {
  return polygons.some((rings) => insidePolygon(point, rings));
}

/**
 * The ground under a point. Water first: a pond in a park is water. Nothing
 * lives inside a building, and open ground away from paths is left empty.
 */
export function habitatAt(
  ground: AnimalGround,
  point: LonLat,
): AnimalHabitat | undefined {
  if (inside(point, ground.water)) return "water";
  if (inside(point, ground.buildings)) return undefined;
  if (inside(point, ground.green)) return "green";
  if (
    ground.paths.some((line) => metersToLine(point, line) <= PATH_REACH_METERS)
  )
    return "path";
  return undefined;
}

function pick<T>(
  table: readonly (readonly [T, number])[],
  draw: number,
): T | undefined {
  let edge = 0;
  for (const [value, share] of table) {
    edge += share;
    if (draw < edge) return value;
  }
  return undefined;
}

/** The animals the spots of one cell keep, on this ground. */
export function animalsOf(
  cell: Cell,
  west: number,
  south: number,
  ground: AnimalGround,
): readonly AnimalSpec[] {
  const cellSeed = hashInts(cell.row, cell.column, 0x5a17);
  const width = longitudeStep(cell.row, ANIMAL_CELL_METERS);
  const height = cellDegrees(ANIMAL_CELL_METERS);
  const animals: AnimalSpec[] = [];
  for (let index = 0; index < SPOTS_PER_CELL; index++) {
    const seed = hashInts(cellSeed, index + 1);
    const home: LonLat = [
      west + unitHash(seed, 1) * width,
      south + unitHash(seed, 2) * height,
    ];
    const habitat = habitatAt(ground, home);
    if (habitat === undefined) continue;
    const kind = pick(ANIMAL_FREQUENCY[habitat], unitHash(seed, 3));
    if (kind === undefined) continue;
    animals.push({
      id: `animal:${cell.row}:${cell.column}:${index}`,
      kind,
      habitat,
      seed,
      home,
      offsetMs: Math.floor(unitHash(seed, 4) * ANIMAL_SLOT_MS),
    });
  }
  return animals;
}

/** The animals on the ground around a point, nearest first, capped. */
export function animalsAround(
  centre: LonLat,
  reachMeters: number,
  ground: AnimalGround,
  max = ANIMAL_MAX_ON_GROUND,
): readonly AnimalSpec[] {
  const found: { animal: AnimalSpec; distance: number }[] = [];
  for (const { cell, west, south } of cellsAround(
    centre,
    reachMeters,
    ANIMAL_CELL_METERS,
  )) {
    for (const animal of animalsOf(cell, west, south, ground)) {
      const distance = metersBetween(centre, animal.home);
      if (distance <= reachMeters) found.push({ animal, distance });
    }
  }
  return found
    .sort(
      (a, b) =>
        a.distance - b.distance || a.animal.id.localeCompare(b.animal.id),
    )
    .slice(0, max)
    .map(({ animal }) => animal);
}

/**
 * An animal's `slot`th waypoint: somewhere around its spot, on the same
 * ground. A waypoint that falls off it (a squirrel's onto the street, a
 * fish's onto the bank) is the spot itself, so it never leaves its habitat.
 */
export function animalWaypoint(
  spec: AnimalSpec,
  slot: number,
  ground: AnimalGround,
): LonLat {
  const gait = GAITS[spec.kind];
  const point = offsetMeters(
    spec.home,
    Math.sqrt(unitHash(spec.seed, 10, slot)) * gait.wanderMeters,
    unitHash(spec.seed, 11, slot) * Math.PI * 2,
  );
  return habitatAt(ground, point) === spec.habitat ? point : spec.home;
}

/** Degrees clockwise from north, from `from` toward `to`. */
function bearingOf(from: LonLat, to: LonLat): number {
  const east = (to[0] - from[0]) * Math.cos(from[1] * RAD);
  const north = to[1] - from[1];
  return (((Math.atan2(east, north) / RAD) % 360) + 360) % 360;
}

function phaseOf<K extends AmbientAnimalKind>(
  kind: K,
  clip: AmbientAnimalClipOf<K>,
  timeMs: number,
): number {
  const seconds: number = ANIMAL_CLIP_SECONDS[kind][clip];
  return (((timeMs / 1_000 / seconds) % 1) + 1) % 1;
}

/**
 * One kind's handle. TypeScript cannot follow a generic kind into the
 * handle's union, so the one cast lives here, behind a signature that admits
 * only that kind's clips.
 */
function handleOf<K extends GroundAnimalKind>(
  kind: K,
  clipId: AmbientAnimalClipOf<K>,
  rest: Omit<AmbientAnimalHandle, "kind" | "clipId" | "clipPhase">,
  timeMs: number,
): AmbientAnimalHandle {
  return {
    ...rest,
    kind,
    clipId,
    clipPhase: phaseOf(kind, clipId, timeMs),
  } as AmbientAnimalHandle;
}

/** Where an animal is at a wall-clock time, and what it is doing. */
export function sampleAnimal(
  spec: AnimalSpec,
  timeMs: number,
  ground: AnimalGround,
): AmbientAnimalHandle {
  return sampleKind(spec.kind, spec, timeMs, ground);
}

function sampleKind<K extends GroundAnimalKind>(
  kind: K,
  spec: AnimalSpec,
  timeMs: number,
  ground: AnimalGround,
): AmbientAnimalHandle {
  const gait: Gait<K> = GAITS[kind];
  const local = timeMs + spec.offsetMs;
  const slot = Math.floor(local / ANIMAL_SLOT_MS);
  const within = local - slot * ANIMAL_SLOT_MS;
  const from = animalWaypoint(spec, slot, ground);
  const to = animalWaypoint(spec, slot + 1, ground);
  const distance = metersBetween(from, to);
  const moveMs = Math.min(
    (distance / gait.speed) * 1_000,
    ANIMAL_SLOT_MS * 0.7,
  );
  // Facing where it went, or at rest where its spot's hash points it.
  const bearingDeg =
    distance > 0.05 ? bearingOf(from, to) : unitHash(spec.seed, 12) * 360;
  const moving = within < moveMs;
  const t = moving ? within / moveMs : 1;
  const clip = moving
    ? gait.move
    : (pick(gait.rest, unitHash(spec.seed, 13, slot)) ?? gait.rest[0][0]);
  return handleOf(
    kind,
    clip,
    {
      id: spec.id,
      lngLat: [
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
      ],
      bearingDeg,
      visible: true,
    },
    timeMs,
  );
}

/** The eagle over a cell, if it keeps one: high up, circling its hub. */
export function eagleOf(cell: Cell): EagleSpec | undefined {
  const seed = hashInts(cell.row, cell.column, 0xea61e);
  if (unitHash(seed, 1) >= EAGLE_SHARE) return undefined;
  const width = longitudeStep(cell.row, EAGLE_CELL_METERS);
  const height = cellDegrees(EAGLE_CELL_METERS);
  const ringMeters = 60 + unitHash(seed, 4) * 60;
  return {
    id: `eagle:${cell.row}:${cell.column}`,
    seed,
    hub: [
      (cell.column + unitHash(seed, 2)) * width,
      (cell.row + unitHash(seed, 3)) * height,
    ],
    ringMeters,
    heightMeters: 35 + unitHash(seed, 5) * 25,
    startAngle: unitHash(seed, 6) * Math.PI * 2,
    // About 12 m/s along the ring, one way or the other.
    turnRate: (unitHash(seed, 7) < 0.5 ? -1 : 1) * (12 / ringMeters),
  };
}

/** The eagles whose ring passes within `reachMeters` of a point. */
export function eaglesAround(
  centre: LonLat,
  reachMeters: number,
): readonly EagleSpec[] {
  const eagles: EagleSpec[] = [];
  for (const { cell } of cellsAround(centre, reachMeters, EAGLE_CELL_METERS)) {
    const eagle = eagleOf(cell);
    if (eagle === undefined) continue;
    if (metersBetween(centre, eagle.hub) - eagle.ringMeters <= reachMeters)
      eagles.push(eagle);
  }
  return eagles;
}

export function sampleEagle(
  spec: EagleSpec,
  timeMs: number,
): AmbientAnimalHandle {
  const angle = spec.startAngle + (timeMs / 1_000) * spec.turnRate;
  const at = offsetMeters(spec.hub, spec.ringMeters, angle);
  // Angles count from east toward north; the tangent is a quarter turn on.
  const heading = angle + (spec.turnRate > 0 ? Math.PI / 2 : -Math.PI / 2);
  const bearingDeg = (((90 - heading / RAD) % 360) + 360) % 360;
  return {
    id: spec.id,
    kind: "eagle",
    lngLat: [at[0], at[1]],
    bearingDeg,
    clipId: "fly",
    clipPhase: phaseOf("eagle", "fly", timeMs),
    heightMeters: spec.heightMeters,
    visible: true,
  };
}
