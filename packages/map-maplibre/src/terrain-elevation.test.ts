// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  loadedTerrainElevationMeters,
  loadedTerrainSlopeRadians,
  terrainBodyPitchRadians,
  terrainElevationMeters,
  terrainSamplePoint,
} from "./terrain-elevation";

describe("terrain elevation", () => {
  it("uses the DEM elevation MapLibre has loaded", () => {
    const queryTerrainElevation = vi.fn(() => 183.25);

    expect(
      terrainElevationMeters(
        { queryTerrainElevation } as never,
        [30.5234, 50.4501],
      ),
    ).toBe(183.25);
    expect(queryTerrainElevation).toHaveBeenCalledWith([30.5234, 50.4501]);
  });

  it("distinguishes a loaded sea-level sample from missing terrain", () => {
    expect(
      loadedTerrainElevationMeters(
        { queryTerrainElevation: () => 0 } as never,
        [30.5234, 50.4501],
      ),
    ).toBe(0);
    expect(
      loadedTerrainElevationMeters(
        { queryTerrainElevation: () => null } as never,
        [30.5234, 50.4501],
      ),
    ).toBeUndefined();
  });

  it("never invents relief when terrain is absent or unreadable", () => {
    expect(terrainElevationMeters(undefined, [30.5234, 50.4501])).toBe(0);
    expect(
      terrainElevationMeters(
        { queryTerrainElevation: () => null } as never,
        [30.5234, 50.4501],
      ),
    ).toBe(0);
    expect(
      terrainElevationMeters(
        { queryTerrainElevation: () => Number.NaN } as never,
        [30.5234, 50.4501],
      ),
    ).toBe(0);
  });
  it("samples a human-stride span along the body's bearing", () => {
    const origin = [30.5234, 50.4501] as const;
    const north = terrainSamplePoint(origin, 0, 1);
    const east = terrainSamplePoint(origin, 90, 1);

    expect(north[1]).toBeGreaterThan(origin[1]);
    expect(Math.abs(north[0] - origin[0])).toBeLessThan(1e-9);
    expect(east[0]).toBeGreaterThan(origin[0]);
    expect(Math.abs(east[1] - origin[1])).toBeLessThan(1e-9);
  });

  it("reads uphill and downhill grade from the loaded DEM", () => {
    const origin = [30.5234, 50.4501] as const;
    const queryTerrainElevation = vi.fn(([lng]: [number, number]) =>
      lng < origin[0] ? 100 : 101.5,
    );

    expect(
      loadedTerrainSlopeRadians({ queryTerrainElevation } as never, origin, 90),
    ).toBeCloseTo(Math.PI / 4, 2);
    expect(
      loadedTerrainSlopeRadians(
        { queryTerrainElevation } as never,
        origin,
        270,
      ),
    ).toBeCloseTo(-Math.PI / 4, 2);
  });

  it("clamps body pitch without inventing a slope when DEM is missing", () => {
    expect(terrainBodyPitchRadians(undefined, [30.5234, 50.4501], 0)).toBe(0);

    const steep = {
      queryTerrainElevation: ([, lat]: [number, number]) =>
        lat < 50.4501 ? 0 : 100,
    };
    expect(
      terrainBodyPitchRadians(steep as never, [30.5234, 50.4501], 0),
    ).toBeCloseTo((25 * Math.PI) / 180);
  });
});
