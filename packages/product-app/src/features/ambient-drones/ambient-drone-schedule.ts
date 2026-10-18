// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { LonLat } from "@nilx-one/walk-graph";

/**
 * Where the city's ambient drones are, as a function of the clock
 * (docs/ambient-drones.md).
 *
 * The world is cut into cells on a fixed grid. Each cell keeps zero to two
 * drones, decided by a hash of the cell alone, and each drone circles its
 * cell's hub through waypoints that are a hash of the drone and the leg's
 * number. A leg's start is the previous leg's end, so a flight is continuous
 * without any leg ever needing the one before it: where a drone is at any
 * moment is computed from that moment, in constant time, never simulated.
 *
 * Nothing here runs while nobody looks. A drone "flies" only in the sense
 * that, whenever someone does look, it is exactly where its schedule says.
 * The same cell at the same moment gives every device the same waypoints;
 * the roads it follows between them come from that device's loaded tiles.
 */

/** Side of a grid cell. */
export const AMBIENT_CELL_METERS = 600;
/** One leg: a hover at its waypoint, then the flight to the next one. */
export const AMBIENT_LEG_MS = 36_000;
export const AMBIENT_HOVER_MS = 4_000;
/** Below this zoom a drone is a speck; none is drawn and nothing runs. */
export const AMBIENT_MIN_ZOOM = 16;
/** The most drones drawn at once, nearest cells first. */
export const AMBIENT_MAX_DRONES = 10;
/** Size against the 1.2 m drone, so one reads at street zoom. */
export const AMBIENT_DRONE_SCALE = 5;

const METERS_PER_DEGREE = 111_195;
const CELL_DEGREES = AMBIENT_CELL_METERS / METERS_PER_DEGREE;
const RAD = Math.PI / 180;

export type AmbientDroneKind = "street" | "yard";

export interface AmbientCell {
  readonly row: number;
  readonly column: number;
}

export interface AmbientDroneSpec {
  /** Stable for the cell and the drone's place in it. */
  readonly id: string;
  readonly kind: AmbientDroneKind;
  readonly seed: number;
  /** The point its waypoints circle. */
  readonly hub: LonLat;
  readonly ringMeters: number;
  readonly startAngle: number;
  /** Signed turn between two waypoints: the drone circles one way. */
  readonly stepAngle: number;
  /** Over the ground the map draws, when it hovers. */
  readonly heightMeters: number;
  /** Shifts its legs against its neighbours', so they never move in step. */
  readonly offsetMs: number;
}

export interface AmbientLegTime {
  /** Which leg: from waypoint `leg` to waypoint `leg + 1`. */
  readonly leg: number;
  /** 0 to 1 through the hover at waypoint `leg`. */
  readonly hover: number;
  /** 0 to 1 through the flight after it; 0 while still hovering. */
  readonly flight: number;
}

/** A 32-bit hash of integers; equal inputs, equal output, on every device. */
export function hashInts(...values: readonly number[]): number {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash = Math.imul(hash ^ (value | 0), 0x01000193);
    hash ^= hash >>> 15;
    hash = Math.imul(hash, 0x2c1b3c6d);
    hash ^= hash >>> 12;
  }
  return hash >>> 0;
}

/** A number in [0, 1) from a seed and a salt. */
export function unitHash(seed: number, ...salt: readonly number[]): number {
  return hashInts(seed, ...salt) / 2 ** 32;
}

/**
 * A row is a band of latitude; its cells are as wide in metres as they are
 * tall, measured at the band's middle, so every row has its own longitude
 * step and the grid stays square at any latitude.
 */
function longitudeStep(row: number): number {
  const latitude = (row + 0.5) * CELL_DEGREES;
  return CELL_DEGREES / Math.max(0.05, Math.cos(latitude * RAD));
}

export function cellOf([longitude, latitude]: LonLat): AmbientCell {
  const row = Math.floor(latitude / CELL_DEGREES);
  return { row, column: Math.floor(longitude / longitudeStep(row)) };
}

export function cellCentre({ row, column }: AmbientCell): LonLat {
  return [(column + 0.5) * longitudeStep(row), (row + 0.5) * CELL_DEGREES];
}

/** Metres between two points, on a plane exact enough for a city. */
export function metersBetween(a: LonLat, b: LonLat): number {
  const east =
    (b[0] - a[0]) * METERS_PER_DEGREE * Math.cos(((a[1] + b[1]) / 2) * RAD);
  const north = (b[1] - a[1]) * METERS_PER_DEGREE;
  return Math.hypot(east, north);
}

/** A point `meters` from `origin` at `angle`, counted from east toward north. */
export function offsetMeters(
  origin: LonLat,
  meters: number,
  angle: number,
): LonLat {
  const north = (meters * Math.sin(angle)) / METERS_PER_DEGREE;
  const east =
    (meters * Math.cos(angle)) /
    (METERS_PER_DEGREE * Math.max(0.05, Math.cos(origin[1] * RAD)));
  return [origin[0] + east, origin[1] + north];
}

/** The cells whose centres lie within `radiusMeters` of a point, nearest first. */
export function cellsAround(
  point: LonLat,
  radiusMeters: number,
): readonly AmbientCell[] {
  const home = cellOf(point);
  const reach = Math.ceil(radiusMeters / AMBIENT_CELL_METERS) + 1;
  const found: { cell: AmbientCell; distance: number }[] = [];
  for (let row = home.row - reach; row <= home.row + reach; row++) {
    const column = cellOf([point[0], (row + 0.5) * CELL_DEGREES]).column;
    for (let step = -reach - 1; step <= reach + 1; step++) {
      const cell = { row, column: column + step };
      const distance = metersBetween(point, cellCentre(cell));
      if (distance <= radiusMeters) found.push({ cell, distance });
    }
  }
  return found
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.cell.row - b.cell.row ||
        a.cell.column - b.cell.column,
    )
    .map(({ cell }) => cell);
}

/**
 * The drones a cell keeps: none in a quarter of cells, one in half, two in
 * the rest. A street drone circles wider and higher; a yard scout keeps
 * close and low, between the buildings.
 */
export function dronesOf(cell: AmbientCell): readonly AmbientDroneSpec[] {
  const cellSeed = hashInts(cell.row, cell.column);
  const draw = unitHash(cellSeed, 1);
  const count = draw < 0.25 ? 0 : draw < 0.75 ? 1 : 2;
  const centre = cellCentre(cell);
  const drones: AmbientDroneSpec[] = [];
  for (let index = 0; index < count; index++) {
    const seed = hashInts(cellSeed, index + 2);
    const kind: AmbientDroneKind = unitHash(seed, 1) < 0.5 ? "street" : "yard";
    const hub = offsetMeters(
      centre,
      unitHash(seed, 2) * AMBIENT_CELL_METERS * 0.25,
      unitHash(seed, 3) * Math.PI * 2,
    );
    const direction = unitHash(seed, 4) < 0.5 ? -1 : 1;
    drones.push({
      id: `ambient:${cell.row}:${cell.column}:${index}`,
      kind,
      seed,
      hub,
      ringMeters:
        kind === "street"
          ? 190 + unitHash(seed, 5) * 90
          : 120 + unitHash(seed, 5) * 70,
      startAngle: unitHash(seed, 6) * Math.PI * 2,
      stepAngle: direction * (Math.PI / 3 + unitHash(seed, 7) * (Math.PI / 6)),
      heightMeters:
        kind === "street"
          ? 16 + unitHash(seed, 8) * 6
          : 9 + unitHash(seed, 8) * 4,
      offsetMs: Math.floor(unitHash(seed, 9) * AMBIENT_LEG_MS),
    });
  }
  return drones;
}

/** The drone's `leg`th waypoint: around its hub, a step further each leg. */
export function waypoint(spec: AmbientDroneSpec, leg: number): LonLat {
  const angle =
    spec.startAngle +
    leg * spec.stepAngle +
    (unitHash(spec.seed, 20, leg) - 0.5) * 0.6;
  const radius = spec.ringMeters * (0.7 + unitHash(spec.seed, 21, leg) * 0.6);
  return offsetMeters(spec.hub, radius, angle);
}

/** Where in its schedule a drone is at a wall-clock time. */
export function legAt(spec: AmbientDroneSpec, timeMs: number): AmbientLegTime {
  const local = timeMs + spec.offsetMs;
  const leg = Math.floor(local / AMBIENT_LEG_MS);
  const within = local - leg * AMBIENT_LEG_MS;
  if (within < AMBIENT_HOVER_MS)
    return { leg, hover: within / AMBIENT_HOVER_MS, flight: 0 };
  return {
    leg,
    hover: 1,
    flight: (within - AMBIENT_HOVER_MS) / (AMBIENT_LEG_MS - AMBIENT_HOVER_MS),
  };
}

/**
 * How far around a camera drones may be worth drawing: the ground the view
 * spans at its zoom, a little further when it is pitched toward the horizon,
 * capped so a tilted view never wakes half the city.
 */
export function ambientReachMeters(
  latitude: number,
  zoom: number,
  pitch: number,
  viewportPixels: number,
): number {
  const metersPerPixel = (78_271.517 * Math.cos(latitude * RAD)) / 2 ** zoom;
  const span = (viewportPixels / 2) * metersPerPixel;
  return Math.min(1_400, span * (1 + Math.max(0, pitch) / 45) + 300);
}

/** The drones to draw around a camera, nearest cells first, capped. */
export function dronesAround(
  centre: LonLat,
  reachMeters: number,
): readonly AmbientDroneSpec[] {
  const drones: AmbientDroneSpec[] = [];
  for (const cell of cellsAround(centre, reachMeters)) {
    for (const drone of dronesOf(cell)) {
      if (drones.length >= AMBIENT_MAX_DRONES) return drones;
      drones.push(drone);
    }
  }
  return drones;
}
