// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";

/** Returns a finite DEM sample only when MapLibre has one loaded. */
export function loadedTerrainElevationMeters(
  map: Pick<MapLibreMap, "queryTerrainElevation"> | undefined,
  lngLat: readonly [longitude: number, latitude: number],
): number | undefined {
  const elevation = map?.queryTerrainElevation([lngLat[0], lngLat[1]]);
  return typeof elevation === "number" && Number.isFinite(elevation)
    ? elevation
    : undefined;
}

/**
 * Returns the terrain surface at a geographic point in metres above sea level.
 *
 * Terrain is presentation data. A renderer without loaded DEM data answers 0
 * rather than inventing relief, which keeps flat presentation and early tile
 * loading deterministic.
 */
export function terrainElevationMeters(
  map: Pick<MapLibreMap, "queryTerrainElevation"> | undefined,
  lngLat: readonly [longitude: number, latitude: number],
): number {
  return loadedTerrainElevationMeters(map, lngLat) ?? 0;
}
