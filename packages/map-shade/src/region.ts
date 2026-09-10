// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cellToBoundary } from "h3-js";

import type { CellIndex } from "@nilx-one/presence-contract";

/**
 * The side of the square the lightmap covers, in metres.
 *
 * The lightmap is a fixed window on the world, not a growing structure: cell
 * count grows without bound as a person walks, and H3 indices do not map to
 * texel coordinates, so per-cell geometry would grow the same way. A fixed
 * texture costs the same at ten cells and at ten thousand.
 */
export const REGION_M = 20_000;

/**
 * Lightmap resolution. 2048 across 20 km is about 9.8 m per texel, so a res-9
 * cell — roughly 400 m across — lands on about 40 texels. Coarse enough to be
 * cheap, fine enough that a cell edge reads as an edge.
 */
export const LIGHTMAP_SIZE = 2048;

/** MapLibre's earth radius, so this projection agrees with the renderer's. */
const EARTH_RADIUS_M = 6_371_008.8;
const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * EARTH_RADIUS_M;

export interface LngLat {
  readonly longitude: number;
  readonly latitude: number;
}

export interface MercatorPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Web Mercator, normalised so [0,0] is the top-left of the world and [1,1] the
 * bottom-right — the same space MapLibre's projection matrix consumes.
 */
export function mercatorFromLngLat({
  longitude,
  latitude,
}: LngLat): MercatorPoint {
  const x = (180 + longitude) / 360;
  const y =
    (180 -
      (180 / Math.PI) *
        Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360))) /
    360;
  return { x, y };
}

/**
 * How much one metre is worth in mercator units at a given latitude. Mercator
 * stretches away from the equator, so this is latitude-dependent and the
 * region is only square in metres near its own anchor.
 */
export function mercatorUnitsPerMetre(latitude: number): number {
  return 1 / (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180));
}

export interface ShadeRegion {
  readonly minX: number;
  readonly minY: number;
  readonly size: number;
  readonly anchor: LngLat;
}

export function createShadeRegion(
  anchor: LngLat,
  sideMetres: number = REGION_M,
): ShadeRegion {
  const centre = mercatorFromLngLat(anchor);
  const size = sideMetres * mercatorUnitsPerMetre(anchor.latitude);
  return {
    minX: centre.x - size / 2,
    minY: centre.y - size / 2,
    size,
    anchor,
  };
}

/** Region-local UV, where [0,0] is the region's top-left corner. */
export function uvFromMercator(
  region: ShadeRegion,
  point: MercatorPoint,
): MercatorPoint {
  return {
    x: (point.x - region.minX) / region.size,
    y: (point.y - region.minY) / region.size,
  };
}

export function uvFromLngLat(
  region: ShadeRegion,
  lngLat: LngLat,
): MercatorPoint {
  return uvFromMercator(region, mercatorFromLngLat(lngLat));
}

export function containsLngLat(region: ShadeRegion, lngLat: LngLat): boolean {
  const { x, y } = uvFromLngLat(region, lngLat);
  return x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

/**
 * The quad the shade is drawn on: the region itself, in mercator coordinates,
 * with UV carried alongside as a varying.
 *
 * Interleaved x, y, u, v. Two triangles rather than a strip, so the draw stays
 * a plain TRIANGLES call next to the cell stamps.
 */
export function regionQuadVertices(region: ShadeRegion): Float32Array {
  const { minX, minY, size } = region;
  const maxX = minX + size;
  const maxY = minY + size;
  return new Float32Array([
    minX,
    minY,
    0,
    0,
    maxX,
    minY,
    1,
    0,
    minX,
    maxY,
    0,
    1,
    maxX,
    minY,
    1,
    0,
    maxX,
    maxY,
    1,
    1,
    minX,
    maxY,
    0,
    1,
  ]);
}

/**
 * A cell's boundary as a triangle fan in lightmap clip space.
 *
 * h3-js returns the boundary as [latitude, longitude] pairs unless asked for
 * GeoJSON order; this reads them in that order deliberately rather than
 * flipping them twice.
 */
export function cellFanVertices(
  region: ShadeRegion,
  cell: CellIndex,
): Float32Array {
  const boundary = cellToBoundary(cell);
  const vertices = new Float32Array(boundary.length * 2);

  for (let index = 0; index < boundary.length; index += 1) {
    const pair = boundary[index];
    const latitude = pair?.[0] ?? 0;
    const longitude = pair?.[1] ?? 0;
    const uv = uvFromLngLat(region, { longitude, latitude });
    // UV to normalised device coordinates: the lightmap is drawn into as a
    // full framebuffer, so the region's 0..1 becomes the viewport's -1..1.
    vertices[index * 2] = uv.x * 2 - 1;
    vertices[index * 2 + 1] = uv.y * 2 - 1;
  }

  return vertices;
}
