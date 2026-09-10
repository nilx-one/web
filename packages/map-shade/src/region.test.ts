// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cellToBoundary, latLngToCell } from "h3-js";
import { MercatorCoordinate } from "maplibre-gl";
import { describe, expect, it } from "vitest";

import {
  LIGHTMAP_SIZE,
  REGION_M,
  cellFanVertices,
  containsLngLat,
  createShadeRegion,
  mercatorFromLngLat,
  mercatorUnitsPerMetre,
  regionQuadVertices,
  uvFromLngLat,
} from "./region";

const ANCHOR = { longitude: 30.5234, latitude: 50.4501 };

describe("the projection the shade quad is drawn in", () => {
  // The lightmap is sampled through a matrix MapLibre builds. If this
  // projection and MapLibre's ever disagree, the shade slides off the ground
  // and nothing else in the layer would reveal it.
  it.each([
    ["Kyiv", 30.5234, 50.4501],
    ["the equator", 0, 0],
    ["the far south", 174.7762, -41.2865],
    ["a high latitude", 18.0686, 69.6492],
  ])("agrees with MapLibre's own mercator at %s", (_place, lng, lat) => {
    const mine = mercatorFromLngLat({ longitude: lng, latitude: lat });
    const theirs = MercatorCoordinate.fromLngLat({ lng, lat });

    expect(mine.x).toBeCloseTo(theirs.x, 12);
    expect(mine.y).toBeCloseTo(theirs.y, 12);
  });

  it.each([
    ["Kyiv", 30.5234, 50.4501],
    ["the equator", 0, 0],
    ["a high latitude", 18.0686, 69.6492],
  ])("agrees with MapLibre's metre scale at %s", (_place, lng, lat) => {
    const theirs = MercatorCoordinate.fromLngLat({
      lng,
      lat,
    }).meterInMercatorCoordinateUnits();

    expect(mercatorUnitsPerMetre(lat)).toBeCloseTo(theirs, 12);
  });
});

describe("the region", () => {
  it("puts its anchor in the middle", () => {
    const region = createShadeRegion(ANCHOR);

    const uv = uvFromLngLat(region, ANCHOR);

    expect(uv.x).toBeCloseTo(0.5, 12);
    expect(uv.y).toBeCloseTo(0.5, 12);
  });

  it("spans the requested distance on the ground", () => {
    const region = createShadeRegion(ANCHOR, REGION_M);
    const metres = mercatorUnitsPerMetre(ANCHOR.latitude);

    expect(region.size / metres).toBeCloseTo(REGION_M, 6);
  });

  it("holds a point well inside it and rejects one far outside", () => {
    const region = createShadeRegion(ANCHOR);

    expect(containsLngLat(region, ANCHOR)).toBe(true);
    expect(containsLngLat(region, { longitude: 13.405, latitude: 52.52 })).toBe(
      false,
    );
  });

  it("resolves a cell to roughly the texel budget it was sized for", () => {
    const metresPerTexel = REGION_M / LIGHTMAP_SIZE;

    expect(metresPerTexel).toBeLessThan(11);
    expect(metresPerTexel).toBeGreaterThan(8);
  });
});

describe("the quad", () => {
  it("covers exactly the region, with UV at the corners", () => {
    const region = createShadeRegion(ANCHOR);
    const vertices = regionQuadVertices(region);

    expect(vertices).toHaveLength(6 * 4);

    const xs: number[] = [];
    const ys: number[] = [];
    for (let index = 0; index < vertices.length; index += 4) {
      xs.push(vertices[index] ?? NaN);
      ys.push(vertices[index + 1] ?? NaN);
      const u = vertices[index + 2] ?? NaN;
      const v = vertices[index + 3] ?? NaN;
      expect([0, 1]).toContain(u);
      expect([0, 1]).toContain(v);
    }

    // Float32 storage, so compared at the ~3e-8 mercator resolution it keeps
    // rather than at double precision. That is sub-metre on the ground.
    expect(Math.min(...xs)).toBeCloseTo(region.minX, 7);
    expect(Math.max(...xs)).toBeCloseTo(region.minX + region.size, 7);
    expect(Math.min(...ys)).toBeCloseTo(region.minY, 7);
    expect(Math.max(...ys)).toBeCloseTo(region.minY + region.size, 7);
  });

  it("pairs each corner's UV with the matching mercator corner", () => {
    const region = createShadeRegion(ANCHOR);
    const vertices = regionQuadVertices(region);
    const metres = mercatorUnitsPerMetre(ANCHOR.latitude);

    for (let index = 0; index < vertices.length; index += 4) {
      const x = vertices[index] ?? NaN;
      const y = vertices[index + 1] ?? NaN;
      const u = vertices[index + 2] ?? NaN;
      const v = vertices[index + 3] ?? NaN;

      // Mercator coordinates are absolute, around 0.58 here, and a float32
      // resolves them to about 3e-8 — under a metre on the ground, and well
      // under the ~10 m texel the lightmap is sampled at. Asserted as ground
      // distance because that is the units the error actually matters in.
      const driftX = Math.abs(x - (region.minX + u * region.size)) / metres;
      const driftY = Math.abs(y - (region.minY + v * region.size)) / metres;

      expect(driftX).toBeLessThan(1);
      expect(driftY).toBeLessThan(1);
    }
  });
});

describe("a cell stamped into the lightmap", () => {
  const cell = latLngToCell(ANCHOR.latitude, ANCHOR.longitude, 9);

  it("produces one clip-space vertex per boundary vertex", () => {
    const region = createShadeRegion(ANCHOR);

    const fan = cellFanVertices(region, cell);

    expect(fan).toHaveLength(cellToBoundary(cell).length * 2);
  });

  it("lands near the middle of the lightmap for a cell on the anchor", () => {
    const region = createShadeRegion(ANCHOR);

    const fan = cellFanVertices(region, cell);

    for (let index = 0; index < fan.length; index += 1) {
      expect(Math.abs(fan[index] ?? NaN)).toBeLessThan(0.1);
    }
  });

  it("reads h3 boundaries as latitude-longitude, not the reverse", () => {
    const region = createShadeRegion(ANCHOR);
    const fan = cellFanVertices(region, cell);
    const boundary = cellToBoundary(cell);

    // Taking the pair in the wrong order would place the first vertex
    // somewhere off the coast of Somalia rather than beside the anchor.
    const [latitude, longitude] = boundary[0] ?? [0, 0];
    const expected = uvFromLngLat(region, { latitude, longitude });

    expect(fan[0]).toBeCloseTo(expected.x * 2 - 1, 6);
    expect(fan[1]).toBeCloseTo(expected.y * 2 - 1, 6);
  });

  it("spans a believable share of the lightmap", () => {
    const region = createShadeRegion(ANCHOR);
    const fan = cellFanVertices(region, cell);
    const xs: number[] = [];
    for (let index = 0; index < fan.length; index += 2) {
      xs.push(fan[index] ?? NaN);
    }
    // Clip space is 2 wide and maps to LIGHTMAP_SIZE texels.
    const texels = ((Math.max(...xs) - Math.min(...xs)) / 2) * LIGHTMAP_SIZE;

    expect(texels).toBeGreaterThan(20);
    expect(texels).toBeLessThan(80);
  });
});
