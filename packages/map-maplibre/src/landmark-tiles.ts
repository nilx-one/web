// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark, MapPointSelection } from "@nilx-one/map-contract";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import { PMTiles } from "pmtiles";

import type { AreaLabel, AreaPart, AreaSources } from "./landmark-areas";
import landmarkAreaKinds from "./landmark-area-kinds.json";
import landmarkKinds from "./landmark-kinds.json";
import { decodeTileShapes } from "./mvt-roads";
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

/** The layers that draw and name areas: parks, reserves and beaches; lakes. */
export const LANDUSE_SOURCE_LAYER = "landuse";
export const WATER_SOURCE_LAYER = "water";

/**
 * The polygon kinds, by layer, an area may be read from. Every other polygon
 * (housing, farmland, the sea) is dropped as it is decoded, so neither the
 * join nor the tiles held ahead carry it. The Avaia's mapper reads a subset
 * of these, and a test keeps every area it reads on this list.
 */
export const AREA_KINDS: Readonly<
  Record<
    typeof LANDUSE_SOURCE_LAYER | typeof WATER_SOURCE_LAYER,
    ReadonlySet<string>
  >
> = {
  landuse: new Set(landmarkAreaKinds.landuse),
  water: new Set(landmarkAreaKinds.water),
};

/** What one tile read ahead holds: its landmark points, and its areas' parts. */
export interface LandmarkTile {
  readonly landmarks: readonly MapLandmark[];
  readonly areas: AreaSources;
}

export type FetchLandmarkTile = (tile: TileId) => Promise<LandmarkTile>;

export interface LandmarkTileCache {
  preload: TileCache<LandmarkTile>["preload"];
  /** Landmarks held within a radius of a point, each once, in no order. */
  landmarksNear(point: MapPointSelection, radiusMeters: number): MapLandmark[];
  /**
   * The area sources of every tile held within a radius of a point, so a
   * label there and the parts of its polygon, wherever they lie, can be joined.
   */
  areaSourcesNear(point: MapPointSelection, radiusMeters: number): AreaSources;
  readonly size: number;
}

/** Nothing to join. */
export const NO_AREA_SOURCES: AreaSources = {
  poiLabels: [],
  landuse: [],
  waterLabels: [],
  water: [],
};

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
      const found = new Map<string, MapLandmark>();
      for (const { landmarks } of tiles.within(
        boxAround(point, radiusMeters),
      )) {
        for (const landmark of landmarks) {
          if (found.has(landmark.id)) continue;
          if (mapDistanceMeters(point, landmark) <= radiusMeters) {
            found.set(landmark.id, landmark);
          }
        }
      }
      return [...found.values()];
    },

    areaSourcesNear(point, radiusMeters) {
      // An area's parts reach past its label: every tile in reach is read.
      return mergeAreaSources(
        tiles.within(boxAround(point, radiusMeters)).map((tile) => tile.areas),
      );
    },

    get size() {
      return tiles.size;
    },
  };
}

/** A box that holds the circle around `point`; the distance decides the rest. */
function boxAround(point: MapPointSelection, radiusMeters: number) {
  const dLat = radiusMeters / 111_195;
  const dLon =
    dLat / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
  return {
    west: point.longitude - dLon,
    east: point.longitude + dLon,
    south: point.latitude - dLat,
    north: point.latitude + dLat,
  };
}

export function mergeAreaSources(sources: readonly AreaSources[]): AreaSources {
  return {
    poiLabels: sources.flatMap((source) => source.poiLabels),
    landuse: sources.flatMap((source) => source.landuse),
    waterLabels: sources.flatMap((source) => source.waterLabels),
    water: sources.flatMap((source) => source.water),
  };
}

/** A named point, as an area's label, or nothing without a name. */
export function areaLabelOf(feature: {
  readonly id: string | number | undefined;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly point: readonly [number, number];
}): AreaLabel | undefined {
  const name = feature.properties["name"];
  if (typeof name !== "string" || name.trim().length === 0) return undefined;
  const kind = feature.properties["kind"];
  const detail = feature.properties["kind_detail"];
  return {
    id: feature.id,
    name,
    point: feature.point,
    ...(typeof kind === "string" ? { kind } : {}),
    ...(typeof detail === "string" ? { kindDetail: detail } : {}),
  };
}

/**
 * A polygon feature as an area part, or nothing when it can be no area: a
 * kind not on `AREA_KINDS`, or a `landuse` polygon without the id its label
 * is found by.
 */
export function areaPartOf(
  layer: keyof typeof AREA_KINDS,
  feature: {
    readonly id: string | number | undefined;
    readonly properties: Readonly<Record<string, unknown>>;
    readonly polygons: AreaPart["polygons"];
    readonly tile?: TileId;
  },
): AreaPart | undefined {
  const kind = feature.properties["kind"];
  if (typeof kind !== "string" || !AREA_KINDS[layer].has(kind)) {
    return undefined;
  }
  if (layer === LANDUSE_SOURCE_LAYER && feature.id === undefined) {
    return undefined;
  }
  const detail = feature.properties["kind_detail"];
  return {
    id: feature.id,
    kind,
    ...(typeof detail === "string" ? { kindDetail: detail } : {}),
    polygons: feature.polygons,
    ...(feature.tile === undefined ? {} : { tile: feature.tile }),
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
  kinds = LANDMARK_KINDS,
}: {
  readonly id: string | number | undefined;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly longitude: number;
  readonly latitude: number;
  /** The kinds that count; landmarks unless a caller names others. */
  readonly kinds?: ReadonlySet<string>;
}): MapLandmark | undefined {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return undefined;
  }
  const kind = properties["kind"];
  if (typeof kind !== "string" || !kinds.has(kind)) return undefined;
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
    if (response === undefined) {
      return { landmarks: [], areas: NO_AREA_SOURCES };
    }
    return decodeLandmarkTile(new Uint8Array(response.data), tile);
  };
}

/** One tile's landmark points, area labels and area parts. */
export function decodeLandmarkTile(
  bytes: Uint8Array,
  tile: TileId,
): LandmarkTile {
  const shapes = decodeTileShapes(bytes, tile, [
    POI_SOURCE_LAYER,
    LANDUSE_SOURCE_LAYER,
    WATER_SOURCE_LAYER,
  ]);
  const pois = shapes[POI_SOURCE_LAYER].points;
  const labels = (layer: readonly Parameters<typeof areaLabelOf>[0][]) =>
    layer.flatMap((feature) => {
      const label = areaLabelOf(feature);
      return label === undefined ? [] : [label];
    });
  const parts = (layer: keyof typeof AREA_KINDS) =>
    shapes[layer].polygons.flatMap((feature) => {
      const part = areaPartOf(layer, { ...feature, tile });
      return part === undefined ? [] : [part];
    });
  return {
    landmarks: pois.flatMap((feature) => {
      const landmark = landmarkFromPoint({
        id: feature.id,
        properties: feature.properties,
        longitude: feature.point[0],
        latitude: feature.point[1],
      });
      return landmark === undefined ? [] : [landmark];
    }),
    areas: {
      poiLabels: labels(pois),
      landuse: parts(LANDUSE_SOURCE_LAYER),
      waterLabels: labels(shapes[WATER_SOURCE_LAYER].points),
      water: parts(WATER_SOURCE_LAYER),
    },
  };
}
