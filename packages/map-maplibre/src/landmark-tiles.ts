// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark, MapPointSelection } from "@nilx-one/map-contract";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import { PMTiles } from "pmtiles";

import landmarkKinds from "./landmark-kinds.json";
import { decodeTilePoints } from "./mvt-roads";
import { createTileCache, type TileCache, type TileId } from "./road-tiles";

/**
 * Landmark tiles read ahead of an outing (docs/avaia-outings.md §0.5).
 *
 * The view holds the landmarks of what is on screen, and an outing's budget
 * reaches kilometres past it. This cache reads the `pois` layer of the tiles
 * covering an outing's area from the same self-hosted archive the map draws,
 * and nothing else. It reads them at the archive's full detail: the basemap
 * schema puts every point on its last zoom and thins the zooms below it, so a
 * museum or a viewpoint is only certain to be there.
 */

/** The archive's point layer: where landmarks are read from. */
export const POI_SOURCE_LAYER = "pois";

/**
 * The zoom landmarks are read ahead at: the archive's last, where the basemap
 * schema keeps every point (Protomaps builds to 15 and gives each point a zoom
 * range ending there; the zooms below are culled to a label grid).
 */
export const LANDMARK_TILE_ZOOM = 15;

/** The most tiles one preload asks for, and the most the cache ever holds. */
export const MAX_LANDMARK_TILES = 32;

/**
 * The `kind` values a body treats as worth walking up to. The published
 * archive follows the Protomaps basemap schema; these are the kinds it assigns
 * to monuments, memorials, art and the like. It is read against the archive,
 * not invented: a kind the archive never carries simply never matches, and
 * `deploy/web/inspect-basemap.sh` is what confirms the list against the real
 * `pois` declaration.
 */
export const LANDMARK_KINDS: ReadonlySet<string> = new Set(landmarkKinds);

export type FetchLandmarkTile = (
  tile: TileId,
) => Promise<readonly MapLandmark[]>;

export interface LandmarkTileCache {
  preload: TileCache<readonly MapLandmark[]>["preload"];
  /** Landmarks held within a radius of a point, each once, in no order. */
  landmarksNear(point: MapPointSelection, radiusMeters: number): MapLandmark[];
  readonly size: number;
}

export function createLandmarkTileCache({
  fetchTile,
  zoom = LANDMARK_TILE_ZOOM,
  maxTiles = MAX_LANDMARK_TILES,
}: {
  readonly fetchTile: FetchLandmarkTile;
  readonly zoom?: number;
  readonly maxTiles?: number;
}): LandmarkTileCache {
  const tiles = createTileCache({ fetchTile, zoom, maxTiles });
  return {
    preload: tiles.preload,

    landmarksNear(point, radiusMeters) {
      // A box that holds the circle; the distance decides the rest.
      const dLat = radiusMeters / 111_195;
      const dLon =
        dLat / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
      const found = new Map<string, MapLandmark>();
      for (const landmarks of tiles.within({
        west: point.longitude - dLon,
        east: point.longitude + dLon,
        south: point.latitude - dLat,
        north: point.latitude + dLat,
      })) {
        for (const landmark of landmarks) {
          if (found.has(landmark.id)) continue;
          if (mapDistanceMeters(point, landmark) <= radiusMeters) {
            found.set(landmark.id, landmark);
          }
        }
      }
      return [...found.values()];
    },

    get size() {
      return tiles.size;
    },
  };
}

/**
 * One archive point as a landmark, or nothing when its kind is not one. The
 * id is the archive's feature id, the same one the view's own tiles carry, so
 * a landmark read ahead and seen on screen is one landmark.
 */
export function landmarkFromPoint({
  id,
  properties,
  longitude,
  latitude,
}: {
  readonly id: string | number | undefined;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly longitude: number;
  readonly latitude: number;
}): MapLandmark | undefined {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }
  const kind = properties["kind"];
  if (typeof kind !== "string" || !LANDMARK_KINDS.has(kind)) return undefined;
  const name = typeof properties["name"] === "string" ? properties["name"] : "";
  const facts: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === "kind" || key === "name") continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts[key] = value;
    }
  }
  // A feature id is the archive's own and survives a tile boundary; without
  // one the place itself is the identity, rounded to well under a metre.
  return {
    id:
      id === undefined
        ? `${kind}:${name}:${longitude.toFixed(6)},${latitude.toFixed(6)}`
        : `poi:${String(id)}`,
    longitude,
    latitude,
    kind,
    ...(name.length === 0 ? {} : { name }),
    facts,
  };
}

/**
 * Fetches landmark tiles from the self-hosted PMTiles archive at `url`: range
 * requests to that one file, nothing else.
 */
export function pmtilesLandmarkTiles(url: string): FetchLandmarkTile {
  let archive: PMTiles | undefined;
  return async (tile) => {
    archive ??= new PMTiles(url);
    const response = await archive.getZxy(tile.z, tile.x, tile.y);
    if (response === undefined) return [];
    return decodeTilePoints(
      new Uint8Array(response.data),
      tile,
      POI_SOURCE_LAYER,
    ).flatMap((feature) => {
      const landmark = landmarkFromPoint({
        id: feature.id,
        properties: feature.properties,
        longitude: feature.point[0],
        latitude: feature.point[1],
      });
      return landmark === undefined ? [] : [landmark];
    });
  };
}
