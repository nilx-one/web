// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapMetersPerPixel,
  mapCompassBearing,
  mapDistanceMeters,
  type MapCamera,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  CAMERA_READ_PIXELS,
  FOLLOW_MIN_ZOOM,
  FOLLOW_PITCH,
  sameFollowCamera,
  cameraChangeVisible,
  cameraKeyCommand,
  followAfterPinch,
  followCamera,
  zoomPivotFor,
  type CameraKeyEvent,
} from "./follow-camera";

const BODY = { longitude: 24.03, latitude: 49.84, bearingDeg: 90 };

function camera(overrides: Partial<MapCamera> = {}): MapCamera {
  return {
    center: [BODY.longitude, BODY.latitude],
    zoom: 18.5,
    bearing: 30,
    pitch: 48,
    ...overrides,
  };
}

/** A point `pixels` east of the body at the camera's zoom. */
function eastBy(pixels: number, zoom = 18.5): readonly [number, number] {
  const meters = pixels * mapMetersPerPixel(BODY.latitude, zoom);
  const degrees =
    meters / (111_320 * Math.cos((BODY.latitude * Math.PI) / 180));
  return [BODY.longitude + degrees, BODY.latitude];
}

function key(overrides: Partial<CameraKeyEvent>): CameraKeyEvent {
  return {
    key: "",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    ...overrides,
  };
}

describe("follow camera", () => {
  it.each([0, 90, 180, 270, 359])(
    "looks over the head along heading %s",
    (bearingDeg) => {
      const body = { ...BODY, bearingDeg };
      const next = followCamera(
        camera({ pitch: 0, bearing: 135, zoom: 14 }),
        body,
      );
      const target = { longitude: next.center[0], latitude: next.center[1] };
      expect(next.pitch).toBe(FOLLOW_PITCH);
      expect(next.zoom).toBe(FOLLOW_MIN_ZOOM);
      expect(next.bearing).toBe(bearingDeg);
      expect(
        ((mapCompassBearing(body, target) - bearingDeg + 540) % 360) - 180,
      ).toBeCloseTo(0, 4);
      expect(mapDistanceMeters(body, target)).toBeCloseTo(
        1.6 * Math.tan(Math.PI / 3),
        4,
      );
    },
  );

  it("keeps a closer zoom and respects explicit flat mode", () => {
    expect(followCamera(camera({ zoom: 22 }), BODY).zoom).toBe(22);
    expect(followCamera(camera(), BODY, "flat")).toMatchObject({
      center: [BODY.longitude, BODY.latitude],
      pitch: 0,
      bearing: 90,
    });
  });

  it("settles without a feedback loop across wrapped headings", () => {
    const next = followCamera(camera(), { ...BODY, bearingDeg: 270 });
    expect(sameFollowCamera({ ...next, bearing: -90 }, next)).toBe(true);
    expect(sameFollowCamera({ ...next, bearing: -89 }, next)).toBe(false);
    expect(sameFollowCamera({ ...next, pitch: 0 }, next)).toBe(false);
  });

  it("closes in on the centre only while locked", () => {
    expect(zoomPivotFor("locked")).toBe("center");
    expect(zoomPivotFor("free")).toBe("pointer");
  });

  it("reads a followed camera again only once it moved visibly", () => {
    const previous = camera();

    expect(
      cameraChangeVisible(
        previous,
        camera({ center: eastBy(CAMERA_READ_PIXELS / 4) }),
      ),
    ).toBe(false);
    expect(
      cameraChangeVisible(
        previous,
        camera({ center: eastBy(CAMERA_READ_PIXELS * 2) }),
      ),
    ).toBe(true);
    expect(cameraChangeVisible(previous, camera({ zoom: 18.6 }))).toBe(true);
    expect(cameraChangeVisible(previous, camera({ bearing: 31 }))).toBe(true);
    expect(cameraChangeVisible(previous, camera({ pitch: 40 }))).toBe(true);
  });
});

describe("pinch mode", () => {
  it("pinching out steps back into Free, pinching in returns to Follow", () => {
    expect(followAfterPinch("locked", 18.5, 17.5)).toBe("free");
    expect(followAfterPinch("free", 16, 17)).toBe("locked");
  });

  it("changes nothing for a nudge or a pinch the way the mode already is", () => {
    expect(followAfterPinch("locked", 18.5, 18.3)).toBe("locked");
    expect(followAfterPinch("free", 16, 16.2)).toBe("free");
    expect(followAfterPinch("locked", 17, 18)).toBe("locked");
    expect(followAfterPinch("free", 18, 17)).toBe("free");
  });
});

describe("camera keys", () => {
  it("centres on Space and toggles the lock on Y on any layout", () => {
    expect(cameraKeyCommand(key({ key: " ", code: "Space" }))).toBe("center");
    expect(cameraKeyCommand(key({ key: "y", code: "KeyY" }))).toBe("toggle");
    expect(cameraKeyCommand(key({ key: "н", code: "KeyY" }))).toBe("toggle");
    expect(cameraKeyCommand(key({ key: "Y" }))).toBe("toggle");
  });

  it("does not repeat a held camera key, including Space", () => {
    expect(
      cameraKeyCommand(key({ key: "y", code: "KeyY", repeat: true })),
    ).toBeUndefined();
    expect(
      cameraKeyCommand(key({ key: " ", code: "Space", repeat: true })),
    ).toBeUndefined();
  });

  it("leaves shortcuts and other keys alone", () => {
    expect(
      cameraKeyCommand(key({ key: "y", code: "KeyY", ctrlKey: true })),
    ).toBeUndefined();
    expect(
      cameraKeyCommand(key({ key: " ", code: "Space", metaKey: true })),
    ).toBeUndefined();
    expect(cameraKeyCommand(key({ key: "x", code: "KeyX" }))).toBeUndefined();
  });

  it("leaves a key pressed into a control to that control", () => {
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      "<button>ok</button>",
      "<div contenteditable='true'></div>",
      "<div role='dialog'><span>line</span></div>",
      "<dialog><span>modal content</span></dialog>",
      "<div role='checkbox'>toggle</div>",
      "<div role='switch'>toggle</div>",
      "<div role='combobox'>choose</div>",
    ]) {
      const host = document.createElement("div");
      host.innerHTML = html;
      document.body.append(host);
      const target =
        host.querySelector("span") ?? (host.firstElementChild as Element);
      expect(
        cameraKeyCommand(key({ key: " ", code: "Space", target })),
      ).toBeUndefined();
      host.remove();
    }
    expect(
      cameraKeyCommand(key({ key: " ", code: "Space", target: document.body })),
    ).toBe("center");
  });
});
