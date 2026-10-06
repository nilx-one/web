// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapArea } from "@nilx-one/map-contract";

/**
 * Named areas from what tiles hold (docs/avaia-osm-landmarks.md).
 *
 * The basemap draws an area and names it in two places. A park, a reserve or a
 * beach is a `landuse` polygon, unnamed, and a `pois` point with its name and
 * the same feature id. A lake is a `water` polygon, unnamed and without an id,
 * and a `water` point with its name, placed inside the polygon. This joins
 * the two, and nothing else: which areas matter is the application's call.
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
      polygons: dedupe(parts.flatMap((part) => part.polygons)),
    });
  }

  for (const label of sources.waterLabels) {
    const same = sources.water.filter(
      (part) =>
        part.kind === label.kind && part.kindDetail === label.kindDetail,
    );
    const pieces = same.flatMap((part) => part.polygons);
    const seed = pieces.filter((polygon) => inside(label.point, polygon));
    if (seed.length === 0) continue;
    const id = `water:${label.name}:${label.point[0].toFixed(6)},${label.point[1].toFixed(6)}`;
    if (areas.has(id)) continue;
    areas.set(id, {
      id,
      layer: "water",
      kind: label.kind ?? "water",
      ...(label.kindDetail === undefined
        ? {}
        : { kindDetail: label.kindDetail }),
      name: label.name,
      label: { longitude: label.point[0], latitude: label.point[1] },
      polygons: dedupe(connected(seed, pieces)),
    });
  }

  return [...areas.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** The pieces reachable from `seed` through pieces that overlap. */
function connected(
  seed: readonly Polygon[],
  pieces: readonly Polygon[],
): Polygon[] {
  const taken = new Set<Polygon>(seed);
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
function overlap(a: Polygon, b: Polygon): boolean {
  const outer = (polygon: Polygon) => polygon[0] ?? [];
  return (
    boxesMeet(outer(a), outer(b)) &&
    (outer(a).some((point) => inside(point, b)) ||
      outer(b).some((point) => inside(point, a)))
  );
}

function boxesMeet(a: Ring, b: Ring): boolean {
  const box = (ring: Ring) => {
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
  };
  const p = box(a);
  const q = box(b);
  return (
    p.west <= q.east &&
    p.east >= q.west &&
    p.south <= q.north &&
    p.north >= q.south
  );
}

/** The same piece read twice, from the view and from a tile read ahead, once. */
function dedupe(polygons: readonly Polygon[]): Polygon[] {
  const seen = new Set<string>();
  return polygons.filter((polygon) => {
    const key = JSON.stringify(polygon[0]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Inside the outer ring and in no hole. */
export function inside(
  [x, y]: readonly [number, number],
  polygon: Polygon,
): boolean {
  let within = false;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        within = !within;
      }
    }
  }
  return within;
}
