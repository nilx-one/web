// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  insideRings,
  type MapArea,
  type MapBounds,
} from "@nilx-one/map-contract";

import { tileBounds, type TileId } from "./road-tiles";

/**
 * Named areas from what tiles hold (docs/avaia-osm-landmarks.md).
 *
 * The basemap draws an area and names it in two places. A park, a reserve or a
 * beach is a `landuse` polygon, unnamed, and a `pois` point with its name and
 * the same feature id. A lake is a `water` polygon, unnamed and without an id,
 * and a `water` point with its name, placed inside the polygon. This joins
 * the two, and nothing else: which areas matter is the application's call.
 *
 * A tile carries its piece of a polygon clipped at its buffer, past its own
 * edge, and the view may hold tiles of more than one zoom. An area keeps the
 * pieces of its deepest zoom only, each cut back to its own tile, so no
 * ground is counted twice where pieces overlap.
 */

type Ring = readonly (readonly [number, number])[];
type Polygon = readonly Ring[];

/** A named point that may label an area. */
export interface AreaLabel {
  readonly id: string | number | undefined;
  readonly name: string;
  readonly point: readonly [number, number];
  /** For a water label, the attributes its polygon must share. */
  readonly kind?: string;
  readonly kindDetail?: string;
}

/** One tile's piece of a polygon feature. */
export interface AreaPart {
  readonly id: string | number | undefined;
  readonly kind: string;
  readonly kindDetail?: string;
  readonly polygons: readonly Polygon[];
  /** The tile the piece came from; without one it is taken as it is. */
  readonly tile?: TileId;
}

/** One polygon of a part, with where it came from and its outer ring's box. */
interface Piece {
  readonly polygon: Polygon;
  readonly tile: TileId | undefined;
  readonly box: MapBounds;
}

export interface AreaSources {
  /** Named `pois` points, any kind. */
  readonly poiLabels: readonly AreaLabel[];
  readonly landuse: readonly AreaPart[];
  /** Named `water` points. */
  readonly waterLabels: readonly AreaLabel[];
  readonly water: readonly AreaPart[];
}

/**
 * Every named area the sources hold, each once, in id order.
 *
 * - `landuse`: a `pois` label and every polygon piece with its feature id.
 * - `water`: a `water` label and every piece of the same kind that contains it
 *   or touches a piece that does, so a lake across a tile edge stays whole as
 *   far as its pieces overlap in the tiles' buffers.
 */
export function joinAreas(sources: AreaSources): MapArea[] {
  const areas = new Map<string, MapArea>();

  const landuseById = new Map<string, AreaPart[]>();
  for (const part of sources.landuse) {
    if (part.id === undefined) continue;
    const key = String(part.id);
    const parts = landuseById.get(key) ?? [];
    parts.push(part);
    landuseById.set(key, parts);
  }
  for (const label of sources.poiLabels) {
    if (label.id === undefined) continue;
    const parts = landuseById.get(String(label.id));
    if (parts === undefined) continue;
    const id = `poi:${String(label.id)}`;
    if (areas.has(id)) continue;
    const [first] = parts;
    areas.set(id, {
      id,
      layer: "landuse",
      kind: first!.kind,
      ...(first!.kindDetail === undefined
        ? {}
        : { kindDetail: first!.kindDetail }),
      name: label.name,
      label: { longitude: label.point[0], latitude: label.point[1] },
      polygons: footprint(parts.flatMap(piecesOf)),
    });
  }

  const water = new Map<
    string,
    { kind: string; kindDetail?: string; pieces: Piece[] }
  >();
  for (const part of sources.water) {
    const key = waterKey(part.kind, part.kindDetail);
    const group = water.get(key) ?? {
      kind: part.kind,
      ...(part.kindDetail === undefined ? {} : { kindDetail: part.kindDetail }),
      pieces: [],
    };
    group.pieces.push(...piecesOf(part));
    water.set(key, group);
  }
  for (const label of sources.waterLabels) {
    for (const key of waterKeysForLabel(label)) {
      const group = water.get(key);
      if (group === undefined) continue;
      const seed = group.pieces.filter(
        (piece) =>
          inBox(label.point, piece.box) &&
          insideRings(label.point, piece.polygon),
      );
      if (seed.length === 0) continue;
      const id = waterAreaId(label);
      if (areas.has(id)) break;
      areas.set(id, {
        id,
        layer: "water",
        kind: group.kind,
        ...(group.kindDetail === undefined
          ? {}
          : { kindDetail: group.kindDetail }),
        name: label.name,
        label: { longitude: label.point[0], latitude: label.point[1] },
        polygons: footprint(connected(seed, group.pieces)),
      });
      break;
    }
  }

  return [...areas.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

function waterKey(kind: string, kindDetail?: string): string {
  return `${kind}\u0000${kindDetail ?? ""}`;
}

/**
 * Water labels and polygons are not guaranteed to use the same schema spelling.
 * A lake label may be `lake`, `water/lake`, or generic `water`; all name
 * the polygon forms the mapper supports for a lake. Other kinds stay exact.
 */
function waterKeysForLabel(label: AreaLabel): string[] {
  if (label.kind === undefined) return [];
  if (
    label.kind === "lake" ||
    (label.kind === "water" &&
      (label.kindDetail === undefined || label.kindDetail === "lake"))
  ) {
    const exact =
      label.kind === "water" && label.kindDetail === undefined
        ? []
        : [waterKey(label.kind, label.kindDetail)];
    return [
      ...new Set([...exact, waterKey("lake"), waterKey("water", "lake")]),
    ];
  }
  return [waterKey(label.kind, label.kindDetail)];
}

/**
 * Prefer the archive feature id. Water labels without one fall back to the
 * same ~1 m coordinate quantization used by normalized landmark ids, so tiny
 * view/read-ahead decode differences do not split one lake into two areas.
 */
function waterAreaId(label: AreaLabel): string {
  if (label.id !== undefined) return `water:${String(label.id)}`;
  const q = (value: number) => Math.round(value * 1e5);
  return `water:${label.name}:${q(label.point[0])}:${q(label.point[1])}`;
}

function piecesOf(part: AreaPart): Piece[] {
  return part.polygons.map((polygon) => ({
    polygon,
    tile: part.tile,
    box: boxOf(polygon[0] ?? []),
  }));
}

/** The pieces reachable from `seed` through pieces that overlap. */
function connected(seed: readonly Piece[], pieces: readonly Piece[]): Piece[] {
  const taken = new Set<Piece>(seed);
  const queue = [...seed];
  while (queue.length > 0) {
    const current = queue.pop()!;
    for (const piece of pieces) {
      if (taken.has(piece) || !overlap(current, piece)) continue;
      taken.add(piece);
      queue.push(piece);
    }
  }
  return [...taken];
}

/** Two pieces overlap when a vertex of either lies inside the other. */
function overlap(a: Piece, b: Piece): boolean {
  if (!boxesMeet(a.box, b.box)) return false;
  const within = (from: Piece, to: Piece) =>
    (from.polygon[0] ?? []).some(
      (point) => inBox(point, to.box) && insideRings(point, to.polygon),
    );
  return within(a, b) || within(b, a);
}

/**
 * The ground an area's pieces cover, each piece once: the deepest zoom's
 * pieces cut back to their own tiles, and a piece read twice taken once.
 */
function footprint(pieces: readonly Piece[]): Polygon[] {
  let deepest = -Infinity;
  for (const { tile } of pieces) {
    if (tile !== undefined) deepest = Math.max(deepest, tile.z);
  }
  const seen = new Set<string>();
  const polygons: Polygon[] = [];
  for (const { polygon, tile } of pieces) {
    if (tile !== undefined && tile.z !== deepest) continue;
    const kept =
      tile === undefined ? polygon : clipPolygon(polygon, tileBounds(tile));
    if (kept === undefined) continue;
    const key = JSON.stringify(kept[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    polygons.push(kept);
  }
  return polygons;
}

/** A polygon cut to a box, or nothing when no ground of it is left inside. */
function clipPolygon(polygon: Polygon, box: MapBounds): Polygon | undefined {
  const [outer, ...holes] = polygon.map((ring) => clipRing(ring, box));
  if (outer === undefined || outer.length < 4) return undefined;
  return [outer, ...holes.filter((hole) => hole.length >= 4)];
}

/** Sutherland–Hodgman against each edge of the box; the ring comes back closed. */
function clipRing(ring: Ring, box: MapBounds): Ring {
  const edges: ((point: readonly [number, number]) => number)[] = [
    ([x]) => x - box.west,
    ([x]) => box.east - x,
    ([, y]) => y - box.south,
    ([, y]) => box.north - y,
  ];
  let points: (readonly [number, number])[] = ring.slice(0, -1);
  for (const side of edges) {
    if (points.length === 0) break;
    const next: (readonly [number, number])[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length]!;
      const b = points[i]!;
      const da = side(a);
      const db = side(b);
      if (db >= 0) {
        if (da < 0) next.push(crossing(a, b, da, db));
        next.push(b);
      } else if (da >= 0) {
        next.push(crossing(a, b, da, db));
      }
    }
    points = next;
  }
  return points.length < 3 ? [] : [...points, points[0]!];
}

function crossing(
  a: readonly [number, number],
  b: readonly [number, number],
  da: number,
  db: number,
): readonly [number, number] {
  const t = da / (da - db);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function boxOf(ring: Ring): MapBounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [x, y] of ring) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  return { west, east, south, north };
}

function boxesMeet(p: MapBounds, q: MapBounds): boolean {
  return (
    p.west <= q.east &&
    p.east >= q.west &&
    p.south <= q.north &&
    p.north >= q.south
  );
}

function inBox([x, y]: readonly [number, number], box: MapBounds): boolean {
  return x >= box.west && x <= box.east && y >= box.south && y <= box.north;
}
