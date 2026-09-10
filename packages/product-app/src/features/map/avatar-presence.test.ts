// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BODY_HANDOVER_ZOOM,
  MAP_SCALE_ZOOM,
  mapMetersPerPixel,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  AVATAR_APPARENT_PIXELS,
  AVATAR_MIN_ZOOM,
  avaiaStudy,
  avatarPresentationScale,
  avatarSeed,
  BODY_HANDLE_IDS,
  createWheelBodyHandle,
  type WheelBodyInput,
} from "./avatar-presence";
import type { DeviceLocationState } from "./device-location";

const LATITUDE = 50.4501;

const located: DeviceLocationState = {
  kind: "active",
  position: {
    longitude: 30.5234,
    latitude: LATITUDE,
    accuracyMeters: 24,
    observedAt: 1_800_000_000_000,
  },
};

function wheelBodyHandle(overrides: Partial<WheelBodyInput> = {}) {
  return createWheelBodyHandle({
    body: { seat: "bond" },
    address: "0x0sky",
    study: "dasha-study",
    location: located,
    zoom: MAP_SCALE_ZOOM.building,
    timeMs: 0,
    reducedMotion: false,
    ...overrides,
  });
}

/** The shortest published study, which is what the policy is held against. */
const STUDY_HEIGHT_METERS = 1.8;

/** The height the body is drawn on screen, which is what "seen" means here. */
function apparentPixels(zoom: number, scale: number): number {
  return (STUDY_HEIGHT_METERS * scale) / mapMetersPerPixel(LATITUDE, zoom);
}

describe("the body at the wheel", () => {
  it("stands the chosen body where the device observed itself", () => {
    expect(wheelBodyHandle()).toMatchObject({
      id: BODY_HANDLE_IDS.bond,
      modelId: "dasha-study",
      lngLat: [30.5234, LATITUDE],
      bearingDeg: 0,
      visible: true,
    });
  });

  it("draws nothing without an observation", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "denied" },
      { kind: "unsupported" },
    ] as DeviceLocationState[]) {
      expect(
        wheelBodyHandle({ study: "kai-study", location: state }),
      ).toBeNull();
    }
  });

  it("keeps one Bond's ambient rhythm stable and separates two Bonds", () => {
    expect(avatarSeed("0x0sky")).toBe(avatarSeed("0x0sky"));
    expect(avatarSeed("0x0sky")).not.toBe(avatarSeed("0x0rain"));
  });

  it("holds still when the person asked for reduced motion", () => {
    expect(
      wheelBodyHandle({
        study: "sky-study",
        timeMs: 12_345,
        reducedMotion: true,
      }),
    ).toMatchObject({ clipId: "idle", clipPhase: 0 });
  });

  // Each identity gets its own handle, so an arriving study can load while the
  // one it is replacing is still settling.
  it("gives each seat a handle of its own", () => {
    expect(wheelBodyHandle({ body: { seat: "avaia" } })?.id).toBe(
      BODY_HANDLE_IDS.avaia,
    );
    expect(BODY_HANDLE_IDS.avaia).not.toBe(BODY_HANDLE_IDS.bond);
  });

  // Arriving and leaving are things a body is doing, so the handover clip wins
  // over the ambient rhythm — including under reduced motion, where it is what
  // makes the change legible at all, and it plays once.
  it("plays the handover clip the wheel is running, not the ambient one", () => {
    for (const reducedMotion of [false, true]) {
      expect(
        wheelBodyHandle({
          body: { seat: "bond", clipId: "wake", clipPhase: 0.5 },
          timeMs: 20_000,
          reducedMotion,
        }),
      ).toMatchObject({ clipId: "wake", clipPhase: 0.5 });
    }
  });

  it("resamples the ambient clip across slots without changing the body", () => {
    const first = wheelBodyHandle({ study: "kai-study" });
    const later = wheelBodyHandle({ study: "kai-study", timeMs: 20_000 });

    expect(first?.modelId).toBe(later?.modelId);
    expect(first?.clipPhase).not.toBe(later?.clipPhase);
  });
});

describe("which body an Avaia wears", () => {
  // Two identities that take turns on one spot have to be told apart, and the
  // study is the only thing distinguishing them at a glance.
  it("never wears its Bond's own study", () => {
    for (const bond of [
      "sky-study",
      "dasha-study",
      "kai-study",
      "dasha-v2-study",
    ] as const) {
      expect(avaiaStudy("0x0sky.avaia", bond)).not.toBe(bond);
    }
  });

  it("wears the same study every time it is drawn", () => {
    expect(avaiaStudy("0x0sky.avaia", "sky-study")).toBe(
      avaiaStudy("0x0sky.avaia", "sky-study"),
    );
  });
});

describe("apparent size of a body", () => {
  // The point of the policy: arriving at the scale focusing lands on has to
  // show a person, and unscaled geography draws one about three pixels tall.
  it("makes the body readable at the scale focusing an identity lands on", () => {
    const zoom = MAP_SCALE_ZOOM.building;
    expect(apparentPixels(zoom, 1)).toBeLessThan(5);
    expect(apparentPixels(zoom, avatarPresentationScale(zoom, LATITUDE))).toBe(
      AVATAR_APPARENT_PIXELS,
    );
  });

  // One size, everywhere. A body is who is standing there, and coming closer
  // must not change what it is — including past the zoom where geography could
  // carry a person on its own.
  it("draws the body the same size at every scale, near and far", () => {
    for (const zoom of [15, 16, MAP_SCALE_ZOOM.building, 18, 19, 20, 22]) {
      expect(
        apparentPixels(zoom, avatarPresentationScale(zoom, LATITUDE)),
      ).toBeCloseTo(AVATAR_APPARENT_PIXELS, 6);
    }
  });

  it("holds that size at any latitude", () => {
    for (const latitude of [0, LATITUDE, -33.87, 78.2]) {
      const scale = avatarPresentationScale(18, latitude);
      const height = (1.8 * scale) / mapMetersPerPixel(latitude, 18);
      expect(height).toBeCloseTo(AVATAR_APPARENT_PIXELS, 6);
    }
  });

  // Past Web Mercator's last parallel the ground a pixel covers collapses, and
  // dividing by it would shrink a body to nothing instead of drawing it.
  it("holds the size at the pole rather than dividing a body away", () => {
    for (const latitude of [90, -90, 85.5]) {
      const scale = avatarPresentationScale(18, latitude);
      expect(scale).toBe(avatarPresentationScale(18, 85.051129));
      expect(scale).toBeGreaterThan(0);
    }
  });

  it("draws a body at a broken latitude rather than nothing at all", () => {
    expect(avatarPresentationScale(18, Number.NaN)).toBe(1);
  });

  it("withdraws the body where an observation is a place, not a person", () => {
    expect(AVATAR_MIN_ZOOM).toBe(MAP_BODY_HANDOVER_ZOOM);
    expect(AVATAR_MIN_ZOOM).toBe(MAP_SCALE_ZOOM.street);
    expect(wheelBodyHandle({ zoom: AVATAR_MIN_ZOOM })?.visible).toBe(true);
    expect(wheelBodyHandle({ zoom: AVATAR_MIN_ZOOM - 0.01 })?.visible).toBe(
      false,
    );
    expect(wheelBodyHandle({ zoom: MAP_SCALE_ZOOM.city })?.visible).toBe(false);
  });
});
