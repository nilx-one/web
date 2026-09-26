// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapBounds,
  type MapObstacle,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * How an Avaia finds its way: anywhere open, around buildings and water, the
 * way a person would cut across a square but not through somebody's house.
 *
 * Ground is laid out as a grid of cells around the walk, the obstacles the
 * basemap paints are pressed into it, and A* finds the way through. The grid
 * path is then pulled taut so the body walks in straight lines and turns at
 * corners instead of zig-zagging cell by cell.
 *
 * It is presentation and nothing else, like the walk it plans: a route is not
 * observed, not persisted, and says nothing about where anyone was.
 */
export type AvaiaRoute =
  | { readonly kind: "route"; readonly path: readonly MapPointSelection[] }
  | { readonly kind: "blocked"; readonly by: MapObstacle["kind"] };

/** The finest cell the grid is laid in: about a stride. */
export const ROUTE_CELL_METERS = 1;

/** No grid is wider or taller than this many cells, however far the walk. */
export const ROUTE_MAX_CELLS = 320;

/** The least room left around a walk to go round what stands in its way. */
export const ROUTE_MIN_MARGIN_METERS = 40;

/** The share of a walk's length left around it as room to detour. */
const ROUTE_MARGIN_SHARE = 0.5;

const EARTH_RADIUS_METERS = 6_371_008.8;

type Ring = readonly (readonly [number, number])[];

interface Plane {
  readonly toLocal: (point: MapPointSelection) => readonly [number, number];
  readonly toWorld: (x: number, y: number) => MapPointSelection;
}

/**
 * The box a walk from `from` to `to` may detour within. The renderer is asked
 * for obstacles in exactly this box, so nothing outside it can matter.
 */
export function routeBounds(
  from: MapPointSelection,
  to: MapPointSelection,
): MapBounds {
  const margin = routeMarginMeters(from, to);
  const latitude = (from.latitude + to.latitude) / 2;
  const dLat = (margin / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.01, Math.cos((latitude * Math.PI) / 180));
  return {
    west: Math.min(from.longitude, to.longitude) - dLng,
    east: Math.max(from.longitude, to.longitude) + dLng,
    south: Math.min(from.latitude, to.latitude) - dLat,
    north: Math.max(from.latitude, to.latitude) + dLat,
  };
}

function routeMarginMeters(
  from: MapPointSelection,
  to: MapPointSelection,
): number {
  return Math.max(
    ROUTE_MIN_MARGIN_METERS,
    mapDistanceMeters(from, to) * ROUTE_MARGIN_SHARE,
  );
}

/**
 * The way from `from` to `to` around `obstacles`, as the points a body turns
 * at, `from` first. A body already standing inside a building walks out of
 * it: the obstacle it stands in does not hold it. A destination inside one is
 * met at the nearest open ground instead.
 */
export function planRoute(
  from: MapPointSelection,
  to: MapPointSelection,
  obstacles: readonly MapObstacle[],
): AvaiaRoute {
  const plane = localPlane(from);
  const start = plane.toLocal(from);
  const goal = plane.toLocal(to);

  const polygons: { readonly kind: MapObstacle["kind"]; rings: Ring[] }[] = [];
  for (const obstacle of obstacles) {
    for (const polygon of obstacle.polygons) {
      const rings = polygon.map((ring) =>
        ring.map(([longitude, latitude]) =>
          plane.toLocal({ longitude, latitude }),
        ),
      );
      if (rings.length === 0 || insidePolygon(start, rings)) continue;
      polygons.push({ kind: obstacle.kind, rings });
    }
  }

  const straight = [
    { longitude: from.longitude, latitude: from.latitude },
    { longitude: to.longitude, latitude: to.latitude },
  ];
  const crossed = polygons.find(
    (polygon) =>
      insidePolygon(goal, polygon.rings) ||
      polygon.rings.some((ring) => segmentCrossesRing(start, goal, ring)),
  );
  if (crossed === undefined) return { kind: "route", path: straight };

  const grid = layGrid(start, goal, routeMarginMeters(from, to));
  for (const polygon of polygons) press(grid, polygon.rings);

  const startCell = grid.cellOf(start);
  clearAround(grid, startCell);
  const goalCell = nearestOpen(grid, grid.cellOf(goal));
  if (goalCell === undefined) return { kind: "blocked", by: crossed.kind };
  const goalIsOpen = goalCell === grid.cellOf(goal);
  if (goalIsOpen) clearAround(grid, goalCell);

  const cells = aStar(grid, startCell, goalCell);
  if (cells === undefined) return { kind: "blocked", by: crossed.kind };

  const points: (readonly [number, number])[] = cells.map((cell) =>
    grid.centerOf(cell),
  );
  points[0] = start;
  points[points.length - 1] = goalIsOpen ? goal : grid.centerOf(goalCell);
  const taut = pullTaut(grid, points);
  const path = taut.map(([x, y]) => plane.toWorld(x, y));
  path[0] = straight[0]!;
  if (goalIsOpen) path[path.length - 1] = straight[1]!;
  return { kind: "route", path };
}

/**
 * A flat plane in metres centred on a point. At walking distances the error
 * of treating the ground as flat is far below a stride.
 */
function localPlane(origin: MapPointSelection): Plane {
  const ky = (EARTH_RADIUS_METERS * Math.PI) / 180;
  const kx = ky * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    toLocal: (point) => [
      (point.longitude - origin.longitude) * kx,
      (point.latitude - origin.latitude) * ky,
    ],
    toWorld: (x, y) => ({
      longitude: origin.longitude + x / kx,
      latitude: origin.latitude + y / ky,
    }),
  };
}

function insidePolygon(
  point: readonly [number, number],
  rings: readonly Ring[],
): boolean {
  // Even-odd over every ring at once: a hole is ground inside the outline.
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

function segmentCrossesRing(
  a: readonly [number, number],
  b: readonly [number, number],
  ring: Ring,
): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (segmentsCross(a, b, ring[j]!, ring[i]!)) return true;
  }
  return false;
}

function segmentsCross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean {
  const cross = (
    o: readonly [number, number],
    p: readonly [number, number],
    q: readonly [number, number],
  ): number => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

interface Grid {
  readonly cols: number;
  readonly rows: number;
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
  /** 1 where a cell's centre stands inside an obstacle. */
  readonly inside: Uint8Array;
  /** 1 where an obstacle's outline passes through a cell. */
  readonly outline: Uint8Array;
  cellOf(point: readonly [number, number]): number;
  centerOf(cell: number): readonly [number, number];
}

function blocked(grid: Grid, cell: number): boolean {
  return grid.inside[cell] === 1 || grid.outline[cell] === 1;
}

function layGrid(
  start: readonly [number, number],
  goal: readonly [number, number],
  margin: number,
): Grid {
  const minX = Math.min(start[0], goal[0]) - margin;
  const minY = Math.min(start[1], goal[1]) - margin;
  const width = Math.abs(start[0] - goal[0]) + margin * 2;
  const height = Math.abs(start[1] - goal[1]) + margin * 2;
  const size = Math.max(
    ROUTE_CELL_METERS,
    Math.max(width, height) / ROUTE_MAX_CELLS,
  );
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const clamp = (value: number, limit: number): number =>
    Math.min(limit - 1, Math.max(0, Math.floor(value)));
  return {
    cols,
    rows,
    size,
    originX: minX,
    originY: minY,
    inside: new Uint8Array(cols * rows),
    outline: new Uint8Array(cols * rows),
    cellOf: ([x, y]) =>
      clamp((y - minY) / size, rows) * cols + clamp((x - minX) / size, cols),
    centerOf: (cell) => [
      minX + ((cell % cols) + 0.5) * size,
      minY + (Math.floor(cell / cols) + 0.5) * size,
    ],
  };
}

/** Presses one obstacle into the grid: its inside, then its outline. */
function press(grid: Grid, rings: readonly Ring[]): void {
  const { cols, rows, size, originX, originY } = grid;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of rings[0]!) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const firstRow = Math.max(0, Math.floor((minY - originY) / size));
  const lastRow = Math.min(rows - 1, Math.floor((maxY - originY) / size));

  // Scanline through each row's centre; even-odd pairs are the inside.
  const crossings: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const y = originY + (row + 0.5) * size;
    crossings.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y) {
          crossings.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(
        0,
        Math.ceil((crossings[k]! - originX) / size - 0.5),
      );
      const to = Math.min(
        cols - 1,
        Math.floor((crossings[k + 1]! - originX) / size - 0.5),
      );
      for (let col = from; col <= to; col++) grid.inside[row * cols + col] = 1;
    }
  }

  // A building thinner than a cell has no centre inside it, so its outline is
  // traced too: a wall is a wall however slim.
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j]!;
      const [bx, by] = ring[i]!;
      const steps = Math.ceil((Math.hypot(bx - ax, by - ay) / size) * 2) + 1;
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const y = ay + ((by - ay) * s) / steps;
        const col = Math.floor((x - originX) / size);
        const row = Math.floor((y - originY) / size);
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
        grid.outline[row * cols + col] = 1;
      }
    }
  }
}

/**
 * A body standing right against a wall still has room to step away from it:
 * the outline around where it stands does not pin it, only the inside does.
 */
function clearAround(grid: Grid, cell: number): void {
  const col = cell % grid.cols;
  const row = Math.floor(cell / grid.cols);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      grid.outline[r * grid.cols + c] = 0;
    }
  }
  grid.inside[cell] = 0;
}

/**
 * The open cell nearest to `cell` as the crow flies. The search spreads ring
 * by ring, and once it has found open ground it keeps looking only as far as
 * a nearer cell could still be.
 */
function nearestOpen(grid: Grid, cell: number): number | undefined {
  if (!blocked(grid, cell)) return cell;
  const [cx, cy] = grid.centerOf(cell);
  const seen = new Uint8Array(grid.cols * grid.rows);
  const queue = [cell];
  const depth = [0];
  seen[cell] = 1;
  let best: number | undefined;
  let bestMeters = Infinity;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    // A ring `d` cells out is never nearer than `d` cells.
    if (depth[head]! * grid.size > bestMeters) break;
    if (!blocked(grid, current)) {
      const [x, y] = grid.centerOf(current);
      const meters = Math.hypot(x - cx, y - cy);
      if (meters < bestMeters) {
        best = current;
        bestMeters = meters;
      }
      continue;
    }
    for (const next of neighbours(grid, current)) {
      if (seen[next.cell] === 1) continue;
      seen[next.cell] = 1;
      queue.push(next.cell);
      depth.push(depth[head]! + 1);
    }
  }
  return best;
}

function* neighbours(
  grid: Grid,
  cell: number,
): Generator<{ readonly cell: number; readonly cost: number }> {
  const col = cell % grid.cols;
  const row = Math.floor(cell / grid.cols);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      yield {
        cell: r * grid.cols + c,
        cost: dx !== 0 && dy !== 0 ? Math.SQRT2 : 1,
      };
    }
  }
}

function aStar(grid: Grid, start: number, goal: number): number[] | undefined {
  const count = grid.cols * grid.rows;
  const cost = new Float64Array(count).fill(Infinity);
  const came = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const goalCol = goal % grid.cols;
  const goalRow = Math.floor(goal / grid.cols);
  const estimate = (cell: number): number => {
    const dx = Math.abs((cell % grid.cols) - goalCol);
    const dy = Math.abs(Math.floor(cell / grid.cols) - goalRow);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const open = new MinHeap();
  cost[start] = 0;
  open.push(start, estimate(start));

  while (open.size > 0) {
    const cell = open.pop();
    if (cell === goal) {
      const path = [cell];
      for (let at = came[cell]!; at !== -1; at = came[at]!) path.push(at);
      return path.reverse();
    }
    if (closed[cell] === 1) continue;
    closed[cell] = 1;
    const col = cell % grid.cols;
    const row = Math.floor(cell / grid.cols);
    for (const next of neighbours(grid, cell)) {
      if (closed[next.cell] === 1 || blocked(grid, next.cell)) continue;
      // No squeezing diagonally between two blocked corners.
      if (next.cost !== 1) {
        const nc = next.cell % grid.cols;
        const nr = Math.floor(next.cell / grid.cols);
        if (
          blocked(grid, row * grid.cols + nc) ||
          blocked(grid, nr * grid.cols + col)
        ) {
          continue;
        }
      }
      const through = cost[cell]! + next.cost;
      if (through < cost[next.cell]!) {
        cost[next.cell] = through;
        came[next.cell] = cell;
        open.push(next.cell, through + estimate(next.cell));
      }
    }
  }
  return undefined;
}

/**
 * Drops every turn a body could walk straight past: from each corner, the
 * furthest point still in clear sight is the next corner.
 */
function pullTaut(
  grid: Grid,
  points: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  const taut = [points[0]!];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    while (
      next + 1 < points.length &&
      inClearSight(grid, points[anchor]!, points[next + 1]!)
    ) {
      next += 1;
    }
    taut.push(points[next]!);
    anchor = next;
  }
  return taut;
}

function inClearSight(
  grid: Grid,
  a: readonly [number, number],
  b: readonly [number, number],
): boolean {
  const steps = Math.ceil(
    (Math.hypot(b[0] - a[0], b[1] - a[1]) / grid.size) * 4,
  );
  const first = grid.cellOf(a);
  const last = grid.cellOf(b);
  for (let s = 1; s < steps; s++) {
    const cell = grid.cellOf([
      a[0] + ((b[0] - a[0]) * s) / steps,
      a[1] + ((b[1] - a[1]) * s) / steps,
    ]);
    if (cell !== first && cell !== last && blocked(grid, cell)) return false;
  }
  return true;
}

/** A binary heap of cells keyed by their estimated total cost. */
class MinHeap {
  private readonly cells: number[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  push(cell: number, key: number): void {
    const { cells, keys } = this;
    let at = cells.length;
    cells.push(cell);
    keys.push(key);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (keys[parent]! <= key) break;
      cells[at] = cells[parent]!;
      keys[at] = keys[parent]!;
      at = parent;
    }
    cells[at] = cell;
    keys[at] = key;
  }

  pop(): number {
    const { cells, keys } = this;
    const top = cells[0]!;
    const lastCell = cells.pop()!;
    const lastKey = keys.pop()!;
    if (cells.length === 0) return top;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      if (left >= cells.length) break;
      const right = left + 1;
      const child =
        right < cells.length && keys[right]! < keys[left]! ? right : left;
      if (keys[child]! >= lastKey) break;
      cells[at] = cells[child]!;
      keys[at] = keys[child]!;
      at = child;
    }
    cells[at] = lastCell;
    keys[at] = lastKey;
    return top;
  }
}
