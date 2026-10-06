// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  loadedTerrainElevationMeters,
  terrainElevationMeters,
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
});
