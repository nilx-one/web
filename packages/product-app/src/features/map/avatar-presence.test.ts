// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MAP_SCALE_ZOOM, mapMetersPerPixel } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  AVATAR_HANDLE_ID,
  AVATAR_MIN_APPARENT_PIXELS,
  AVATAR_MIN_ZOOM,
  avatarPresentationScale,
  avatarSeed,
  createSelfAvatarHandle,
  type SelfAvatarInput,
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

function selfAvatar(overrides: Partial<SelfAvatarInput> = {}) {
  return createSelfAvatarHandle({
    pubDress: "0x0sky",
    model: "dasha-study",
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

describe("self avatar presence", () => {
  it("stands the chosen body where the device observed itself", () => {
    expect(selfAvatar()).toMatchObject({
      id: AVATAR_HANDLE_ID,
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
      expect(selfAvatar({ model: "kai-study", location: state })).toBeNull();
    }
  });

  it("keeps one Bond's ambient rhythm stable and separates two Bonds", () => {
    expect(avatarSeed("0x0sky")).toBe(avatarSeed("0x0sky"));
    expect(avatarSeed("0x0sky")).not.toBe(avatarSeed("0x0rain"));
  });

  it("holds still when the person asked for reduced motion", () => {
    expect(
      selfAvatar({ model: "sky-study", timeMs: 12_345, reducedMotion: true }),
    ).toMatchObject({ clipId: "idle", clipPhase: 0 });
  });

  it("resamples the ambient clip across slots without changing the body", () => {
    const first = selfAvatar({ model: "kai-study" });
    const later = selfAvatar({ model: "kai-study", timeMs: 20_000 });

    expect(first?.modelId).toBe(later?.modelId);
    expect(first?.clipPhase).not.toBe(later?.clipPhase);
  });
});

describe("apparent size of a body", () => {
  // The point of the policy: arriving at the Bond's own scale has to show a
  // person, and unscaled geography draws one about three pixels tall there.
  it("makes the body readable at the scale focusing a Bond lands on", () => {
    const zoom = MAP_SCALE_ZOOM.building;
    expect(apparentPixels(zoom, 1)).toBeLessThan(5);
    expect(apparentPixels(zoom, avatarPresentationScale(zoom, LATITUDE))).toBe(
      AVATAR_MIN_APPARENT_PIXELS,
    );
  });

  it("holds the same readable height across the scales it covers", () => {
    for (const zoom of [15, 16, MAP_SCALE_ZOOM.building, 17, 18, 19]) {
      expect(
        apparentPixels(zoom, avatarPresentationScale(zoom, LATITUDE)),
      ).toBeCloseTo(AVATAR_MIN_APPARENT_PIXELS, 6);
    }
  });

  // Past the crossover the world itself is close enough, and a body that kept
  // its presentation size would start lying about how tall a person is.
  it("hands the body back to true scale once geography can carry it", () => {
    expect(avatarPresentationScale(20, LATITUDE)).toBe(1);
    expect(avatarPresentationScale(22, LATITUDE)).toBe(1);
    expect(avatarPresentationScale(19, LATITUDE)).toBeGreaterThan(1);
  });

  it("never shrinks a body below the size the world gives it", () => {
    for (const zoom of [15, 17, 19, 19.5, 20, 21]) {
      expect(avatarPresentationScale(zoom, LATITUDE)).toBeGreaterThanOrEqual(1);
    }
  });

  it("resolves a latitude with no ground under it to true scale", () => {
    expect(avatarPresentationScale(18, 90)).toBe(1);
  });

  it("withdraws the body where an observation is a place, not a person", () => {
    expect(AVATAR_MIN_ZOOM).toBe(MAP_SCALE_ZOOM.street);
    expect(selfAvatar({ zoom: AVATAR_MIN_ZOOM })?.visible).toBe(true);
    expect(selfAvatar({ zoom: AVATAR_MIN_ZOOM - 0.01 })?.visible).toBe(false);
    expect(selfAvatar({ zoom: MAP_SCALE_ZOOM.city })?.visible).toBe(false);
  });
});
