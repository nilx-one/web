// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex } from "@nilx-one/presence-contract";
import { cellToBoundary, cellsToMultiPolygon } from "h3-js";

import type { FogAtlas } from "./fog-atlas";

/** Web Mercator's latitude limit: the whole map MapLibre can draw. */
const MERCATOR_LAT = 85.051_129;

/**
 * How far the world's hole sits inside the atlas square, as a share of its
 * side. The two surfaces overlap by this much, so no hairline of open map
 * shows between them under antialiasing or terrain draping.
 */
const OVERLAP = 0.0025;

type Ring = [number, number][];

/** A GeoJSON Feature, spelled out so no GeoJSON typings are needed. */
export interface WorldFog {
  readonly type: "Feature";
  readonly properties: Record<string, never>;
  readonly geometry: {
    readonly type: "MultiPolygon";
    readonly coordinates: Ring[][];
  };
}

export interface FogWorldBounds {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
}

/** In Web Mercator a geographic square is bounded by two meridians and two parallels. */
export function atlasBounds(
  coordinates: FogAtlas["coordinates"],
): FogWorldBounds {
  const [[west, north], , [east, south]] = coordinates;
  return { west, east, south, north };
}

/** Whether any of a cell reaches past the atlas, where only the world fog lies. */
export function beyondAtlas(cell: CellIndex, bounds: FogWorldBounds): boolean {
  return cellToBoundary(cell, true).some(
    ([lng, lat]) =>
      lng < bounds.west ||
      lng > bounds.east ||
      lat < bounds.south ||
      lat > bounds.north,
  );
}

function signedArea(ring: Ring): number {
  let area = 0;
  for (
    let index = 0, last = ring.length - 1;
    index < ring.length;
    last = index++
  )
    area +=
      (ring[last]![0] - ring[index]![0]) * (ring[last]![1] + ring[index]![1]);
  return area;
}

/** Outer rings counter-clockwise, holes clockwise: MapLibre tells them apart by winding. */
function wind(ring: Ring, clockwise: boolean): Ring {
  return signedArea(ring) > 0 === clockwise ? ring : [...ring].reverse();
}

function square(
  west: number,
  south: number,
  east: number,
  north: number,
): Ring {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/**
 * Mist over the whole Earth except the atlas, which draws its own, and the
 * ground revealed wholly beyond it. Revealed cells that straddle the atlas
 * edge are left to the atlas: a hole overlapping the atlas hole would break
 * the polygon.
 */
export function worldFog(
  bounds: FogWorldBounds,
  revealedBeyond: readonly CellIndex[],
): WorldFog {
  const insetX = (bounds.east - bounds.west) * OVERLAP;
  const insetY = (bounds.north - bounds.south) * OVERLAP;
  const holes: Ring[] = [
    square(
      bounds.west + insetX,
      bounds.south + insetY,
      bounds.east - insetX,
      bounds.north - insetY,
    ),
  ];
  const islands: Ring[][] = [];
  const outside = revealedBeyond.filter(
    (cell) =>
      !cellToBoundary(cell, true).some(
        ([lng, lat]) =>
          lng >= bounds.west &&
          lng <= bounds.east &&
          lat >= bounds.south &&
          lat <= bounds.north,
      ),
  );
  for (const [outer, ...enclosed] of cellsToMultiPolygon(outside, true)) {
    holes.push(outer as Ring);
    // Unrevealed ground ringed by revealed ground is still fog.
    for (const ring of enclosed) islands.push([wind(ring as Ring, false)]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [
          wind(square(-180, -MERCATOR_LAT, 180, MERCATOR_LAT), false),
          ...holes.map((ring) => wind(ring, true)),
        ],
        ...islands,
      ],
    },
  };
}
