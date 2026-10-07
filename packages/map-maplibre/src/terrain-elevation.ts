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

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Geographic point a short ground distance away on a compass bearing. */
export function terrainSamplePoint(
  lngLat: readonly [longitude: number, latitude: number],
  bearingDeg: number,
  meters: number,
): readonly [longitude: number, latitude: number] {
  const bearing = (bearingDeg * Math.PI) / 180;
  const latitude = (lngLat[1] * Math.PI) / 180;
  const dNorth = Math.cos(bearing) * meters;
  const dEast = Math.sin(bearing) * meters;
  const dLat = dNorth / EARTH_RADIUS_METERS;
  const dLng =
    dEast / (EARTH_RADIUS_METERS * Math.max(0.01, Math.cos(latitude)));
  return [
    lngLat[0] + (dLng * 180) / Math.PI,
    lngLat[1] + (dLat * 180) / Math.PI,
  ];
}

/**
 * Measured grade under a body, positive uphill in the direction it faces.
 *
 * Missing DEM on either side means no claimed slope. The sample spans a
 * human stride so terrain changes are felt locally instead of from tile-scale
 * averages.
 */
export function loadedTerrainSlopeRadians(
  map: Pick<MapLibreMap, "queryTerrainElevation"> | undefined,
  lngLat: readonly [longitude: number, latitude: number],
  bearingDeg: number,
  halfSpanMeters = 0.75,
): number | undefined {
  const behind = terrainSamplePoint(lngLat, bearingDeg + 180, halfSpanMeters);
  const ahead = terrainSamplePoint(lngLat, bearingDeg, halfSpanMeters);
  const low = loadedTerrainElevationMeters(map, behind);
  const high = loadedTerrainElevationMeters(map, ahead);
  if (low === undefined || high === undefined) return undefined;
  return Math.atan2(high - low, halfSpanMeters * 2);
}

/**
 * A body follows measured ground but never pitches into implausible DEM spikes.
 * 25° is a presentation clamp, not a rewrite of terrain elevation.
 */
export function terrainBodyPitchRadians(
  map: Pick<MapLibreMap, "queryTerrainElevation"> | undefined,
  lngLat: readonly [longitude: number, latitude: number],
  bearingDeg: number,
): number {
  const slope = loadedTerrainSlopeRadians(map, lngLat, bearingDeg) ?? 0;
  const limit = (25 * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, slope));
}
