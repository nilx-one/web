// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MAP_SCALE_ZOOM, type MapCamera } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { observation } from "../../../../../tests/support/doubles";
import {
  FIRST_FIX_SCALE,
  cameraFramesPosition,
  cameraMotion,
  firstFixCamera,
  locationCameraPadding,
  locationCameraPitch,
  locationCameraZoom,
  recenterCamera,
} from "./location-camera-policy";

const SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };

const VOLUMETRIC = {
  presentation: "regular" as const,
  dimension: "volumetric" as const,
  safeArea: SAFE_AREA,
};

describe("first fix camera policy", () => {
  it("lands at neighbourhood scale rather than maximum building zoom", () => {
    const camera = firstFixCamera(observation(), VOLUMETRIC);

    expect(FIRST_FIX_SCALE).toBe("neighborhood");
    expect(camera.center).toEqual([30.5234, 50.4501]);
    expect(camera.zoom).toBe(MAP_SCALE_ZOOM.neighborhood);
    expect(camera.zoom).toBeLessThan(MAP_SCALE_ZOOM.building);
  });

  it("opens wider on a narrow viewport so the same context fits", () => {
    const compact = locationCameraZoom("neighborhood", "compact");
    const wide = locationCameraZoom("neighborhood", "wide");

    expect(compact).toBeLessThan(MAP_SCALE_ZOOM.neighborhood);
    expect(wide).toBeGreaterThan(MAP_SCALE_ZOOM.neighborhood);
  });
});

describe("zoom progression", () => {
  it("raises pitch continuously from city to building scale", () => {
    const city = locationCameraPitch(MAP_SCALE_ZOOM.city, "volumetric");
    const street = locationCameraPitch(MAP_SCALE_ZOOM.street, "volumetric");
    const building = locationCameraPitch(MAP_SCALE_ZOOM.building, "volumetric");

    expect(city).toBe(0);
    expect(street).toBeGreaterThan(city);
    expect(building).toBeGreaterThan(street);
  });

  it("never overrides an explicit 2D presentation", () => {
    expect(locationCameraPitch(MAP_SCALE_ZOOM.building, "flat")).toBe(0);
    expect(
      firstFixCamera(observation(), { ...VOLUMETRIC, dimension: "flat" }).pitch,
    ).toBe(0);
  });
});

describe("recenter policy", () => {
  const current: MapCamera = {
    center: [24.03, 49.84],
    zoom: MAP_SCALE_ZOOM.building,
    bearing: 18,
    pitch: 44,
  };

  it("keeps the camera the person built and only moves it onto the observation", () => {
    const camera = recenterCamera(observation(), current, VOLUMETRIC);

    expect(camera.center).toEqual([30.5234, 50.4501]);
    expect(camera.zoom).toBe(MAP_SCALE_ZOOM.building);
    expect(camera.bearing).toBe(18);
    expect(camera.pitch).toBe(44);
  });

  it("raises a camera too far out to carry local context", () => {
    const camera = recenterCamera(
      observation(),
      { ...current, zoom: 4, pitch: 0 },
      VOLUMETRIC,
    );

    expect(camera.zoom).toBe(MAP_SCALE_ZOOM.neighborhood);
  });

  it("flattens the camera in explicit 2D", () => {
    const camera = recenterCamera(observation(), current, {
      ...VOLUMETRIC,
      dimension: "flat",
    });

    expect(camera.pitch).toBe(0);
  });
});

describe("responsive camera padding", () => {
  it("clears header, Dock and safe-area chrome", () => {
    const padding = locationCameraPadding({
      ...VOLUMETRIC,
      safeArea: { top: 44, right: 0, bottom: 34, left: 0 },
    });

    expect(padding.top).toBeGreaterThan(44);
    expect(padding.bottom).toBeGreaterThan(34);
    expect(padding.left).toBeGreaterThan(0);
  });

  it("reserves more room where the chrome is larger", () => {
    const compact = locationCameraPadding({
      ...VOLUMETRIC,
      presentation: "compact",
      safeArea: SAFE_AREA,
    });
    const wide = locationCameraPadding({
      ...VOLUMETRIC,
      presentation: "wide",
      safeArea: SAFE_AREA,
    });

    expect(wide.bottom).toBeGreaterThan(compact.bottom);
  });
});

describe("motion and framing", () => {
  it("falls back to a non-animated camera update under reduced motion", () => {
    expect(cameraMotion(true)).toBe("immediate");
    expect(cameraMotion(false)).toBe("eased");
  });

  it("separates a camera that frames the observation from one that does not", () => {
    const position = observation();
    const centered: MapCamera = {
      center: [position.longitude, position.latitude],
      zoom: MAP_SCALE_ZOOM.neighborhood,
      bearing: 0,
      pitch: 0,
    };

    expect(cameraFramesPosition(centered, position)).toBe(true);
    expect(
      cameraFramesPosition({ ...centered, center: [30.6, 50.5] }, position),
    ).toBe(false);
  });

  it("scales the framing tolerance with zoom", () => {
    const position = observation();
    const nudged: [number, number] = [
      position.longitude + 0.002,
      position.latitude,
    ];

    expect(
      cameraFramesPosition(
        { center: nudged, zoom: MAP_SCALE_ZOOM.city, bearing: 0, pitch: 0 },
        position,
      ),
    ).toBe(true);
    expect(
      cameraFramesPosition(
        { center: nudged, zoom: MAP_SCALE_ZOOM.building, bearing: 0, pitch: 0 },
        position,
      ),
    ).toBe(false);
  });
});
