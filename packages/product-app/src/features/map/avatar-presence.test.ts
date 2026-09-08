// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AVATAR_HANDLE_ID,
  avatarSeed,
  createSelfAvatarHandle,
} from "./avatar-presence";
import type { DeviceLocationState } from "./device-location";

const located: DeviceLocationState = {
  kind: "active",
  position: {
    longitude: 30.5234,
    latitude: 50.4501,
    accuracyMeters: 24,
    observedAt: 1_800_000_000_000,
  },
};

describe("self avatar presence", () => {
  it("stands the chosen body where the device observed itself", () => {
    expect(
      createSelfAvatarHandle("0x0sky", "dasha-study", located, 0, false),
    ).toMatchObject({
      id: AVATAR_HANDLE_ID,
      modelId: "dasha-study",
      lngLat: [30.5234, 50.4501],
      bearingDeg: 0,
      scale: 1,
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
        createSelfAvatarHandle("0x0sky", "kai-study", state, 0, false),
      ).toBeNull();
    }
  });

  it("keeps one Bond's ambient rhythm stable and separates two Bonds", () => {
    expect(avatarSeed("0x0sky")).toBe(avatarSeed("0x0sky"));
    expect(avatarSeed("0x0sky")).not.toBe(avatarSeed("0x0rain"));
  });

  it("holds still when the person asked for reduced motion", () => {
    expect(
      createSelfAvatarHandle("0x0sky", "sky-study", located, 12_345, true),
    ).toMatchObject({ clipId: "idle", clipPhase: 0 });
  });

  it("resamples the ambient clip across slots without changing the body", () => {
    const first = createSelfAvatarHandle(
      "0x0sky",
      "kai-study",
      located,
      0,
      false,
    );
    const later = createSelfAvatarHandle(
      "0x0sky",
      "kai-study",
      located,
      20_000,
      false,
    );

    expect(first?.modelId).toBe(later?.modelId);
    expect(first?.clipPhase).not.toBe(later?.clipPhase);
  });
});
