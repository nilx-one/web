// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapBounds,
  MapGround,
  MapGroundTap,
  MapObstacle,
  MapPointSelection,
  MapRenderer,
  MapRoad,
} from "@nilx-one/map-contract";
import { surfaceOf } from "@nilx-one/walk-graph";

/**
 * The ground a body walks on, as the basemap draws it: open ground, the
 * terraces people walk across on top of buildings, and the steps between
 * them.
 *
 * A building is a wall, as before, unless the map runs a footway or steps
 * across it: then it is a terrace — the museum platform under the
 * Motherland, a roof garden, a raised square — and a body walks on its top.
 * Parts of a building that stand within a terrace and rise no higher than a
 * storey above it are terraces too, the stepped tiers of one platform. A
 * terrace's edge stays a wall wherever the level drops more than a step, so
 * a body gets up and down only by its steps, and on a flight of steps it
 * climbs from the level at one end to the level at the other.
 *
 * Like the walks it shapes, this is presentation: it reads what the map
 * draws and says nothing about where anyone was.
 */
export interface WalkGround {
  /** What a body walks round: walls, the terraces' ledges, and water. */
  readonly walls: readonly MapObstacle[];
  /** Metres above the drawn ground a body standing here stands. */
  liftAt(point: MapPointSelection): number;
  /** Whether a terrace a body may walk on is under this point. */
  onTerrace(point: MapPointSelection): boolean;
}

/** Path run across a building, in metres, that makes it a terrace. */
export const TERRACE_MIN_PATH_METERS = 3;

/**
 * How much higher a part standing within a terrace may rise and still be
 * the same platform, walked onto from it.
 */
export const TERRACE_TIER_RISE_METERS = 6;

/** A change of level a body simply steps over. Anything more is a ledge. */
export const STEP_UP_METERS = 1;

/** How far either side of a flight of steps is still on it. */
export const STAIR_REACH_METERS = 1.5;

/**
 * A part whose underside starts this high is overhead — an arm of a statue,
 * a covered walkway between two blocks — and a body walks under it.
 */
export const OVERHEAD_BASE_METERS = 2;

/** Where a climbing flight's side walls stand, just past its reach. */
const STAIR_SIDE_METERS = STAIR_REACH_METERS + 0.1;

/** How finely paths are measured and ledges are traced. */
const SAMPLE_METERS = 1;

/** How thick a ledge is drawn as a wall. */
const LEDGE_METERS = 0.2;

/** A box walkGround reads a tapped point's ground in. */
export const TAP_GROUND_RADIUS_METERS = 60;

const EARTH_RADIUS_METERS = 6_371_008.8;
const BUCKET_METERS = 16;

type Point = readonly [number, number];
type Ring = readonly Point[];

interface Part {
  readonly obstacle: number;
  readonly polygon: number;
  readonly rings: readonly Ring[];
  readonly height: number;
  readonly box: Box;
}

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

interface Flight {
  readonly points: readonly Point[];
  /** Distance along the flight to each point. */
  readonly along: readonly number[];
  readonly from: number;
  readonly to: number;
}

const FLAT: WalkGround = {
  walls: [],
  liftAt: () => 0,
  onTerrace: () => false,
};

export function walkGround(
  obstacles: readonly MapObstacle[],
  roads: readonly MapRoad[],
): WalkGround {
  const anchor = firstPoint(obstacles, roads);
  if (anchor === undefined) return { ...FLAT, walls: obstacles };
  const plane = localPlane(anchor);

  // Where people walk: every footway and flight of steps, sampled a metre
  // apart. Indoor corridors are walked inside a building, not on it.
  const samples = new Buckets<{
    readonly point: Point;
    readonly steps: boolean;
  }>();
  const flights: Point[][] = [];
  for (const road of roads) {
    const surface = surfaceOf(road.kind, road.kindDetail);
    if (surface !== "footway" && surface !== "steps") continue;
    if (road.kindDetail === "corridor") continue;
    for (const line of road.lines) {
      const local = line.map(([longitude, latitude]) =>
        plane.toLocal(longitude, latitude),
      );
      if (surface === "steps" && local.length >= 2) flights.push(local);
      const steps = surface === "steps";
      for (const point of sampleLine(local))
        samples.add({ point, steps }, point);
    }
  }

  // Buildings at ground level; anything overhead is walked under.
  const parts: Part[] = [];
  obstacles.forEach((obstacle, index) => {
    if (obstacle.kind !== "building") return;
    obstacle.polygons.forEach((polygon, at) => {
      if ((obstacle.bases?.[at] ?? 0) >= OVERHEAD_BASE_METERS) return;
      const rings = polygon.map((ring) =>
        ring.map(([longitude, latitude]) => plane.toLocal(longitude, latitude)),
      );
      if (rings[0] === undefined || rings[0].length < 3) return;
      parts.push({
        obstacle: index,
        polygon: at,
        rings,
        height: obstacle.heights?.[at] ?? 0,
        box: boxOf(rings[0]),
      });
    });
  });

  // A part people walk across is a terrace. One they mostly climb across
  // is a staircase drawn as a building: walked on too, but its height says
  // nothing of where a body stands on it — its flight of steps does.
  const terraces = new Set<Part>();
  const staircases = new Set<Part>();
  for (const part of parts) {
    let walked = 0;
    let climbed = 0;
    for (const { point, steps } of samples.within(part.box)) {
      if (!insideRings(point, part.rings)) continue;
      if (steps) climbed += SAMPLE_METERS;
      else walked += SAMPLE_METERS;
    }
    if (walked + climbed < TERRACE_MIN_PATH_METERS) continue;
    terraces.add(part);
    if (climbed >= TERRACE_MIN_PATH_METERS && climbed >= walked) {
      staircases.add(part);
    }
  }
  // Tiers of one platform: a part standing within a terrace, not much
  // higher than it, is walked onto from it. Each pass may find the tier
  // the next one stands on.
  const platforms = new Buckets<Part>();
  for (const terrace of terraces)
    platforms.add(terrace, ...corners(terrace.box));
  for (let grew = terraces.size > 0; grew;) {
    grew = false;
    for (const part of parts) {
      if (terraces.has(part)) continue;
      const corner: Point = [part.box.west, part.box.south];
      for (const terrace of platforms.near(corner)) {
        if (part.height > terrace.height + TERRACE_TIER_RISE_METERS) continue;
        if (!within(part, terrace)) continue;
        terraces.add(part);
        platforms.add(part, ...corners(part.box));
        grew = true;
        break;
      }
    }
  }
  if (terraces.size === 0) {
    return { ...FLAT, walls: withoutOverhead(obstacles) };
  }

  const tops = new Buckets<Part>();
  for (const terrace of terraces) {
    if (!staircases.has(terrace)) tops.add(terrace, ...corners(terrace.box));
  }
  const level = (point: Point): number => {
    let height = 0;
    for (const terrace of tops.near(point)) {
      if (terrace.height <= height) continue;
      if (inBox(point, terrace.box) && insideRings(point, terrace.rings)) {
        height = terrace.height;
      }
    }
    return height;
  };

  const stairs = flights.map((points) => flightOf(points, level));
  // Each flight is filed under every cell it comes within reach of.
  const flightsNear = new Buckets<Flight>();
  for (const flight of stairs) {
    const box = boxOf(flight.points);
    const pad = 2 * STAIR_REACH_METERS;
    flightsNear.add(
      flight,
      [box.west - pad, box.south - pad],
      [box.east + pad, box.north + pad],
    );
  }
  const nearStairs = (point: Point, reach: number): boolean =>
    flightsNear
      .near(point)
      .some((flight) => distanceToLine(flight.points, point) <= reach);

  // A terrace's edge is a wall wherever the level drops more than a step,
  // and open where its steps come up.
  const ledges: Ring[] = [];
  const ledgeHeights: number[] = [];
  for (const terrace of terraces) {
    for (const ring of terrace.rings) {
      for (let i = 1; i < ring.length; i++) {
        traceLedges(ring[i - 1]!, ring[i]!, level, nearStairs, (run, drop) => {
          ledges.push(run);
          ledgeHeights.push(drop);
        });
      }
    }
  }
  // A flight that climbs is walled along both sides, so a body steps onto
  // it at the foot or the top, never off the ground halfway up.
  for (const flight of stairs) {
    const rise = Math.abs(flight.to - flight.from);
    if (rise <= STEP_UP_METERS) continue;
    for (let i = 1; i < flight.points.length; i++) {
      for (const side of [-1, 1]) {
        ledges.push(
          sideWall(
            flight.points[i - 1]!,
            flight.points[i]!,
            side * STAIR_SIDE_METERS,
          ),
        );
        ledgeHeights.push(rise);
      }
    }
  }

  const partAt = new Map(
    parts.map((part) => [`${part.obstacle}:${part.polygon}`, part]),
  );
  const walls: MapObstacle[] = [];
  obstacles.forEach((obstacle, index) => {
    if (obstacle.kind !== "building") {
      walls.push(obstacle);
      return;
    }
    const polygons: (typeof obstacle.polygons)[number][] = [];
    const heights: number[] = [];
    obstacle.polygons.forEach((polygon, at) => {
      if ((obstacle.bases?.[at] ?? 0) >= OVERHEAD_BASE_METERS) return;
      const part = partAt.get(`${index}:${at}`);
      if (part !== undefined && terraces.has(part)) return;
      polygons.push(polygon);
      heights.push(obstacle.heights?.[at] ?? 0);
    });
    if (polygons.length === 0) return;
    walls.push(
      obstacle.heights === undefined
        ? { kind: "building", polygons }
        : { kind: "building", polygons, heights },
    );
  });
  if (ledges.length > 0) {
    walls.push({
      kind: "building",
      polygons: ledges.map((ring) => [
        ring.map(([x, y]) => plane.toWorld(x, y)),
      ]),
      heights: ledgeHeights,
    });
  }

  return {
    walls,
    liftAt(point) {
      const local = plane.toLocal(point.longitude, point.latitude);
      // Anywhere on a staircase, or right beside a flight, the nearest
      // flight says how far up a body has climbed.
      const onStaircase = [...staircases].some(
        (part) => inBox(local, part.box) && insideRings(local, part.rings),
      );
      let best: { readonly lift: number; readonly off: number } | undefined;
      for (const flight of onStaircase ? stairs : flightsNear.near(local)) {
        const on = onFlight(flight, local);
        if (on === undefined) continue;
        if (!onStaircase && on.off > STAIR_REACH_METERS) continue;
        if (best === undefined || on.off < best.off) best = on;
      }
      return best?.lift ?? level(local);
    },
    onTerrace(point) {
      const local = plane.toLocal(point.longitude, point.latitude);
      return (
        level(local) > 0 &&
        !parts.some(
          (part) =>
            !terraces.has(part) &&
            inBox(local, part.box) &&
            insideRings(local, part.rings),
        )
      );
    },
  };
}

/** The box `walkGround` should be read over to judge a tapped point. */
export function tapGroundBounds(point: MapPointSelection): MapBounds {
  const dLat =
    (TAP_GROUND_RADIUS_METERS / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng =
    dLat / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
  return {
    west: point.longitude - dLng,
    east: point.longitude + dLng,
    south: point.latitude - dLat,
    north: point.latitude + dLat,
  };
}

/**
 * What is under a tap, for walking. The renderer calls whatever a building
 * paints "building"; a terrace is a building a body walks on, so a tap on
 * one is open ground, the way the museum platform under the Motherland is.
 */
export function groundUnderTap(
  renderer: Pick<MapRenderer, "obstaclesWithin" | "roadsWithin">,
  tap: MapGroundTap,
): MapGround {
  if (tap.ground !== "building") return tap.ground;
  const bounds = tapGroundBounds(tap);
  const ground = walkGround(
    renderer.obstaclesWithin?.(bounds) ?? [],
    renderer.roadsWithin?.(bounds) ?? [],
  );
  return ground.onTerrace(tap) ? "open" : "building";
}

function withoutOverhead(obstacles: readonly MapObstacle[]): MapObstacle[] {
  const walls: MapObstacle[] = [];
  for (const obstacle of obstacles) {
    if (obstacle.kind !== "building" || obstacle.bases === undefined) {
      walls.push(obstacle);
      continue;
    }
    const keep = obstacle.polygons
      .map((polygon, at) => ({ polygon, at }))
      .filter(({ at }) => (obstacle.bases?.[at] ?? 0) < OVERHEAD_BASE_METERS);
    if (keep.length === 0) continue;
    walls.push({
      kind: "building",
      polygons: keep.map(({ polygon }) => polygon),
      ...(obstacle.heights === undefined
        ? {}
        : { heights: keep.map(({ at }) => obstacle.heights?.[at] ?? 0) }),
    });
  }
  return walls;
}

/**
 * Walks one edge of a terrace a metre at a time, comparing the level just
 * either side of it, and hands on each run where the drop is more than a
 * step and no steps come up, as a thin wall along the edge.
 */
function traceLedges(
  a: Point,
  b: Point,
  level: (point: Point) => number,
  nearStairs: (point: Point, reach: number) => boolean,
  emit: (run: Ring, drop: number) => void,
): void {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length === 0) return;
  const dx = (b[0] - a[0]) / length;
  const dy = (b[1] - a[1]) / length;
  const nx = -dy;
  const ny = dx;
  const pieces = Math.max(1, Math.ceil(length / SAMPLE_METERS));
  let runStart: number | undefined;
  let drop = 0;
  const close = (end: number) => {
    if (runStart === undefined) return;
    const s = (runStart / pieces) * length;
    const e = (end / pieces) * length;
    const p = (t: number, side: number): Point => [
      a[0] + dx * t + nx * side,
      a[1] + dy * t + ny * side,
    ];
    const half = LEDGE_METERS / 2;
    emit([p(s, -half), p(e, -half), p(e, half), p(s, half), p(s, -half)], drop);
    runStart = undefined;
    drop = 0;
  };
  for (let i = 0; i < pieces; i++) {
    const t = ((i + 0.5) / pieces) * length;
    const mid: Point = [a[0] + dx * t, a[1] + dy * t];
    const left = level([mid[0] + nx * 0.75, mid[1] + ny * 0.75]);
    const right = level([mid[0] - nx * 0.75, mid[1] - ny * 0.75]);
    const step = Math.abs(left - right);
    const ledge = step > STEP_UP_METERS && !nearStairs(mid, STAIR_REACH_METERS);
    if (ledge) {
      runStart ??= i;
      drop = Math.max(drop, step);
    } else {
      close(i);
    }
  }
  close(pieces);
}

/** A thin wall along `a`–`b`, `offset` metres to its left (or right). */
function sideWall(a: Point, b: Point, offset: number): Ring {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (-(b[1] - a[1]) / length) * offset;
  const ny = ((b[0] - a[0]) / length) * offset;
  const half = LEDGE_METERS / 2 / Math.abs(offset);
  const p = (q: Point, k: number): Point => [q[0] + nx * k, q[1] + ny * k];
  return [
    p(a, 1 - half),
    p(b, 1 - half),
    p(b, 1 + half),
    p(a, 1 + half),
    p(a, 1 - half),
  ];
}

/**
 * A flight of steps, with the level it climbs from and to: each end's level
 * is read a little past the end too, since steps are drawn up to a
 * terrace's edge, not onto it.
 */
function flightOf(points: readonly Point[], level: (p: Point) => number) {
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(
      along[i - 1]! +
        Math.hypot(
          points[i]![0] - points[i - 1]![0],
          points[i]![1] - points[i - 1]![1],
        ),
    );
  }
  const endLevel = (end: Point, before: Point): number => {
    const length = Math.hypot(end[0] - before[0], end[1] - before[1]) || 1;
    const past: Point = [
      end[0] + ((end[0] - before[0]) / length) * STAIR_REACH_METERS,
      end[1] + ((end[1] - before[1]) / length) * STAIR_REACH_METERS,
    ];
    return Math.max(level(end), level(past));
  };
  const last = points.length - 1;
  return {
    points,
    along,
    from: endLevel(points[0]!, points[1]!),
    to: endLevel(points[last]!, points[last - 1]!),
  } satisfies Flight;
}

/** Where on a flight a point stands: how high, and how far beside it. */
function onFlight(
  flight: Flight,
  point: Point,
): { readonly lift: number; readonly off: number } | undefined {
  const total = flight.along[flight.along.length - 1]!;
  if (total === 0) return undefined;
  let best: { readonly lift: number; readonly off: number } | undefined;
  for (let i = 1; i < flight.points.length; i++) {
    const a = flight.points[i - 1]!;
    const b = flight.points[i]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const span = vx * vx + vy * vy;
    if (span === 0) continue;
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / span),
    );
    const off = Math.hypot(a[0] + vx * t - point[0], a[1] + vy * t - point[1]);
    if (best !== undefined && off >= best.off) continue;
    const share = (flight.along[i - 1]! + Math.sqrt(span) * t) / total;
    best = { lift: flight.from + (flight.to - flight.from) * share, off };
  }
  return best;
}

function distanceToLine(line: readonly Point[], point: Point): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const span = vx * vx + vy * vy;
    const t =
      span === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / span,
            ),
          );
    best = Math.min(
      best,
      Math.hypot(a[0] + vx * t - point[0], a[1] + vy * t - point[1]),
    );
  }
  return best;
}

/** Whether `part` stands within `terrace`: its body, not just a corner. */
function within(part: Part, terrace: Part): boolean {
  if (
    part.box.west < terrace.box.west ||
    part.box.east > terrace.box.east ||
    part.box.south < terrace.box.south ||
    part.box.north > terrace.box.north
  ) {
    return false;
  }
  const outer = part.rings[0]!;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of outer) {
    cx += x;
    cy += y;
  }
  cx /= outer.length;
  cy /= outer.length;
  if (!insideRings([cx, cy], terrace.rings)) return false;
  // Pulled a little in from each corner, so a shared edge is not a doubt.
  return outer.every(([x, y]) =>
    insideRings([cx + (x - cx) * 0.9, cy + (y - cy) * 0.9], terrace.rings),
  );
}

function sampleLine(line: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(length / SAMPLE_METERS));
    for (let s = 0; s < n; s++) {
      out.push([
        a[0] + ((b[0] - a[0]) * s) / n,
        a[1] + ((b[1] - a[1]) * s) / n,
      ]);
    }
  }
  return out;
}

function insideRings(point: Point, rings: readonly Ring[]): boolean {
  let inside = false;
  const [x, y] = point;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function boxOf(ring: Ring): Box {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of ring) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return { west, south, east, north };
}

function inBox(point: Point, box: Box): boolean {
  return (
    point[0] >= box.west &&
    point[0] <= box.east &&
    point[1] >= box.south &&
    point[1] <= box.north
  );
}

function corners(box: Box): [Point, Point] {
  return [
    [box.west, box.south],
    [box.east, box.north],
  ];
}

/** A coarse grid of what lies where, so a lookup reads only its own cell. */
class Buckets<T> {
  private readonly cells = new Map<string, T[]>();

  /** Files `item` under every cell of the box `from`–`to` (or one point). */
  add(item: T, from: Point, to: Point = from): void {
    for (let x = cell(from[0]); x <= cell(to[0]); x++) {
      for (let y = cell(from[1]); y <= cell(to[1]); y++) {
        const id = `${x},${y}`;
        const bucket = this.cells.get(id);
        if (bucket === undefined) this.cells.set(id, [item]);
        else bucket.push(item);
      }
    }
  }

  near(point: Point): readonly T[] {
    return this.cells.get(`${cell(point[0])},${cell(point[1])}`) ?? [];
  }

  *within(box: Box): Generator<T> {
    for (let x = cell(box.west); x <= cell(box.east); x++) {
      for (let y = cell(box.south); y <= cell(box.north); y++) {
        yield* this.cells.get(`${x},${y}`) ?? [];
      }
    }
  }
}

function cell(metres: number): number {
  return Math.floor(metres / BUCKET_METERS);
}

function firstPoint(
  obstacles: readonly MapObstacle[],
  roads: readonly MapRoad[],
): readonly [number, number] | undefined {
  for (const obstacle of obstacles) {
    const point = obstacle.polygons[0]?.[0]?.[0];
    if (point !== undefined) return point;
  }
  for (const road of roads) {
    const point = road.lines[0]?.[0];
    if (point !== undefined) return point;
  }
  return undefined;
}

function localPlane(origin: readonly [number, number]) {
  const ky = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const kx = ky * Math.cos((origin[1] * Math.PI) / 180);
  return {
    toLocal: (longitude: number, latitude: number): Point => [
      (longitude - origin[0]) * kx,
      (latitude - origin[1]) * ky,
    ],
    toWorld: (x: number, y: number): [number, number] => [
      origin[0] + x / kx,
      origin[1] + y / ky,
    ],
  };
}
