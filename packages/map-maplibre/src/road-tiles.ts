// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapBounds,
  MapRoad,
  MapRoadPreload,
} from "@nilx-one/map-contract";
import { PMTiles } from "pmtiles";

import { decodeTileRoads } from "./mvt-roads";

/**
 * Road tiles read ahead of an outing (docs/avaia-outings.md §0.5, #312).
 *
 * The renderer only holds the tiles the current view needs, and an outing
 * walks well past them. This cache fetches the `roads` layer of the tiles
 * covering an outing's area, from the same self-hosted archive the map draws,
 * and nothing else: one zoom, a fixed cap on how many tiles it ever holds, and
 * the oldest dropped first. What it holds is answered by `roadsWithin` beside
 * what the view has loaded.
 */

/** The archive's road network source layer: what a body walks along. */
export const ROAD_SOURCE_LAYER = "roads";

/** The zoom roads are read ahead at: footways and paths are in it. */
export const ROAD_TILE_ZOOM = 14;

/** The most tiles one preload asks for, and the most the cache ever holds. */
export const MAX_ROAD_TILES = 32;

export interface TileId {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export type FetchRoadTile = (tile: TileId) => Promise<readonly MapRoad[]>;

export interface RoadTileCache {
  /**
   * Makes sure the tiles covering `bounds` are held, nearest the centre first,
   * at most `MAX_ROAD_TILES` of them. A tile `accept` turns down is not
   * fetched: the walk could not go there anyway.
   */
  preload(
    bounds: MapBounds,
    accept?: (tile: MapBounds) => boolean,
  ): Promise<MapRoadPreload>;
  /** Roads held in tiles touching `bounds`, clipped to the requested bounds. */
  roadsWithin(bounds: MapBounds): MapRoad[];
  /** How many tiles are held now. */
  readonly size: number;
}

export function createRoadTileCache({
  fetchTile,
  zoom = ROAD_TILE_ZOOM,
  maxTiles = MAX_ROAD_TILES,
}: {
  readonly fetchTile: FetchRoadTile;
  readonly zoom?: number;
  readonly maxTiles?: number;
}): RoadTileCache {
  // Insertion order is age: a tile touched again moves to the end.
  const held = new Map<string, readonly MapRoad[]>();
  const pending = new Map<string, Promise<readonly MapRoad[] | undefined>>();

  const keyOf = ({ z, x, y }: TileId) => `${z}/${x}/${y}`;

  const touch = (key: string, roads: readonly MapRoad[]) => {
    held.delete(key);
    held.set(key, roads);
    while (held.size > maxTiles) {
      const oldest = held.keys().next().value;
      if (oldest === undefined) break;
      held.delete(oldest);
    }
  };

  const load = (tile: TileId) => {
    const key = keyOf(tile);
    const inFlight = pending.get(key);
    if (inFlight !== undefined) return inFlight;
    const request = fetchTile(tile)
      .then(
        (roads) => roads,
        () => undefined,
      )
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };

  return {
    async preload(bounds, accept) {
      const covering = tilesCovering(bounds, zoom);
      const wanted = covering.filter(
        (tile) => accept === undefined || accept(tileBounds(tile)),
      );
      const centre = {
        longitude: (bounds.west + bounds.east) / 2,
        latitude: (bounds.south + bounds.north) / 2,
      };
      const chosen = nearestFirst(wanted, centre).slice(0, maxTiles);
      let cached = 0;
      let fetched = 0;
      let failed = 0;
      const missing: TileId[] = [];
      for (const tile of chosen) {
        const key = keyOf(tile);
        const roads = held.get(key);
        if (roads === undefined) {
          missing.push(tile);
        } else {
          cached += 1;
          touch(key, roads);
        }
      }
      const results = await Promise.all(missing.map(load));
      results.forEach((roads, index) => {
        if (roads === undefined) {
          failed += 1;
          return;
        }
        fetched += 1;
        touch(keyOf(missing[index]!), roads);
      });
      return {
        covering: covering.length,
        refused: covering.length - wanted.length,
        skipped: wanted.length - chosen.length,
        cached,
        fetched,
        failed,
      };
    },

    roadsWithin(bounds) {
      const found: MapRoad[] = [];
      for (const [key, roads] of held) {
        const [z, x, y] = key.split("/").map(Number) as [
          number,
          number,
          number,
        ];
        if (!overlaps(tileBounds({ z, x, y }), bounds)) continue;
        for (const road of roads) {
          const lines = road.lines.flatMap((line) =>
            clipLineToBounds(line, bounds),
          );
          if (lines.length > 0) found.push({ ...road, lines });
        }
      }
      return found;
    },

    get size() {
      return held.size;
    },
  };
}

/** The tiles at `z` a box touches, row by row. */
export function tilesCovering(bounds: MapBounds, z: number): TileId[] {
  const last = 2 ** z - 1;
  const clamp = (value: number) => Math.min(last, Math.max(0, value));
  const x0 = clamp(Math.floor(tileX(bounds.west, z)));
  const x1 = clamp(Math.floor(tileX(bounds.east, z)));
  const y0 = clamp(Math.floor(tileY(bounds.north, z)));
  const y1 = clamp(Math.floor(tileY(bounds.south, z)));
  const tiles: TileId[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  }
  return tiles;
}

export function tileBounds({ z, x, y }: TileId): MapBounds {
  const n = 2 ** z;
  const lon = (column: number) => (column / n) * 360 - 180;
  const lat = (row: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

function tileX(longitude: number, z: number): number {
  return ((longitude + 180) / 360) * 2 ** z;
}

function tileY(latitude: number, z: number): number {
  const rad = (latitude * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  );
}

function nearestFirst(
  tiles: readonly TileId[],
  centre: { readonly longitude: number; readonly latitude: number },
): TileId[] {
  const distance = (tile: TileId) => {
    const b = tileBounds(tile);
    const dx = (b.west + b.east) / 2 - centre.longitude;
    const dy = (b.south + b.north) / 2 - centre.latitude;
    return dx * dx + dy * dy;
  };
  return [...tiles].sort(
    (a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x,
  );
}

function overlaps(a: MapBounds, b: MapBounds): boolean {
  return (
    a.west <= b.east &&
    a.east >= b.west &&
    a.south <= b.north &&
    a.north >= b.south
  );
}

type LinePoint = readonly [number, number];
type RoadLine = readonly LinePoint[];

/** Clips a polyline to `bounds`, splitting it when it leaves and re-enters. */
function clipLineToBounds(line: RoadLine, bounds: MapBounds): RoadLine[] {
  if (line.length < 2) return [];

  const clipped: RoadLine[] = [];
  let current: LinePoint[] = [];

  for (let index = 1; index < line.length; index += 1) {
    const segment = clipSegmentToBounds(line[index - 1]!, line[index]!, bounds);
    if (segment === undefined) {
      if (current.length >= 2) clipped.push(current);
      current = [];
      continue;
    }

    const [start, end] = segment;
    if (current.length === 0) {
      current = [start, end];
      continue;
    }

    const last = current[current.length - 1]!;
    if (last[0] === start[0] && last[1] === start[1]) {
      current.push(end);
    } else {
      if (current.length >= 2) clipped.push(current);
      current = [start, end];
    }
  }

  if (current.length >= 2) clipped.push(current);
  return clipped;
}

/** Liang-Barsky clipping for one line segment against a longitude/latitude box. */
function clipSegmentToBounds(
  start: LinePoint,
  end: LinePoint,
  bounds: MapBounds,
): [LinePoint, LinePoint] | undefined {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let t0 = 0;
  let t1 = 1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };

  if (
    !clip(-dx, start[0] - bounds.west) ||
    !clip(dx, bounds.east - start[0]) ||
    !clip(-dy, start[1] - bounds.south) ||
    !clip(dy, bounds.north - start[1])
  ) {
    return undefined;
  }

  // A vertex inside the box is kept exactly, so consecutive segments still
  // meet and the line is not split at every vertex.
  const pointAt = (t: number): LinePoint =>
    t === 0 ? start : t === 1 ? end : [start[0] + dx * t, start[1] + dy * t];
  return [pointAt(t0), pointAt(t1)];
}

/**
 * Fetches road tiles from the self-hosted PMTiles archive at `url`: range
 * requests to that one file, nothing else. The archive is opened on the first
 * tile asked for.
 */
export function pmtilesRoadTiles(url: string): FetchRoadTile {
  let archive: PMTiles | undefined;
  return async (tile) => {
    archive ??= new PMTiles(url);
    const response = await archive.getZxy(tile.z, tile.x, tile.y);
    if (response === undefined) return [];
    return decodeTileRoads(
      new Uint8Array(response.data),
      tile,
      ROAD_SOURCE_LAYER,
    );
  };
}
