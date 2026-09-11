// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MAP_SCALE_ZOOM, type MapCamera } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  FRAGMENT_MAX_SCALE,
  FRAGMENT_MIN_SCALE,
  fragmentCamera,
  fragmentZoomBounds,
} from "./fragment-camera-policy";

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };
const VOLUMETRIC = {
  presentation: "regular" as const,
  dimension: "volumetric" as const,
  safeArea: SAFE_AREA,
};
const ANCHOR = {
  cell: "891e2045b47ffff",
  center: [30.5234, 50.4501] as const,
};

function camera(zoom: number, pitch = 0): MapCamera {
  return {
    center: [24.03, 49.84],
    zoom,
    bearing: 18,
    pitch,
  };
}

describe("cell-bound fragment camera policy", () => {
  it("frames the cell centre without inventing a more precise location", () => {
    const target = fragmentCamera(
      ANCHOR,
      camera(MAP_SCALE_ZOOM.neighborhood),
      VOLUMETRIC,
    );

    expect(target.center).toEqual(ANCHOR.center);
    expect(target.bearing).toBe(18);
  });

  it("bounds a far-out camera at neighborhood scale", () => {
    const bounds = fragmentZoomBounds(VOLUMETRIC);
    const target = fragmentCamera(
      ANCHOR,
      camera(MAP_SCALE_ZOOM.country),
      VOLUMETRIC,
    );

    expect(FRAGMENT_MIN_SCALE).toBe("neighborhood");
    expect(target.zoom).toBe(bounds.minimum);
    expect(target.pitch).toBeGreaterThanOrEqual(0);
  });

  it("bounds a close camera at street scale instead of forcing a building close-up", () => {
    const bounds = fragmentZoomBounds(VOLUMETRIC);
    const target = fragmentCamera(
      ANCHOR,
      camera(MAP_SCALE_ZOOM.building, 48),
      VOLUMETRIC,
    );

    expect(FRAGMENT_MAX_SCALE).toBe("street");
    expect(target.zoom).toBe(bounds.maximum);
    expect(target.zoom).toBeLessThan(MAP_SCALE_ZOOM.building);
  });

  it("preserves a camera already inside the bounded range", () => {
    const target = fragmentCamera(
      ANCHOR,
      camera(MAP_SCALE_ZOOM.neighborhood + 0.5, 17),
      VOLUMETRIC,
    );

    expect(target.zoom).toBe(MAP_SCALE_ZOOM.neighborhood + 0.5);
    expect(target.pitch).toBe(17);
  });

  it("keeps explicit 2D flat", () => {
    expect(
      fragmentCamera(ANCHOR, camera(MAP_SCALE_ZOOM.building, 48), {
        ...VOLUMETRIC,
        dimension: "flat",
      }).pitch,
    ).toBe(0);
  });
});
