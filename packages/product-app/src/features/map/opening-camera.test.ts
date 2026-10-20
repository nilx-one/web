// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import { openingCamera } from "./opening-camera";
import { followCamera, isometricCamera } from "./follow-camera";
import { firstFixCamera } from "./location-camera-policy";

const position = {
  longitude: 30.5636,
  latitude: 50.4267,
  accuracyMeters: 24,
  observedAt: 0,
};
const context = {
  presentation: "compact",
  dimension: "volumetric",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
} as const;

describe("opening camera composition", () => {
  it.each(["isometric", "locked"] as const)(
    "lands directly in %s without a second framing change",
    (mode) => {
      const camera = openingCamera(position, context, mode, 120);
      const tracking = mode === "isometric" ? isometricCamera : followCamera;
      expect(
        tracking(camera, { ...position, bearingDeg: 120 }, context.dimension),
      ).toEqual(camera);
      expect(position.longitude).toBe(30.5636);
      expect(camera.zoom).toBe(18.5);
    },
  );
  it("keeps Free framing and explicit 2D", () => {
    expect(openingCamera(position, context, "free")).toEqual(
      firstFixCamera(position, context),
    );
    expect(
      openingCamera(position, { ...context, dimension: "flat" }, "isometric")
        .pitch,
    ).toBe(0);
  });
  it("does not tighten a coarse GPS fix and keeps declared position framing", () => {
    expect(
      openingCamera({ ...position, accuracyMeters: 800 }, context, "isometric")
        .zoom,
    ).toBe(14.5);
    expect(
      openingCamera({ ...position, declared: true }, context, "isometric").zoom,
    ).toBe(20.25);
  });
});
