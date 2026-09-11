// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  INITIAL_CAMERA_COORDINATION,
  completeCameraFocus,
  coordinateCameraFocus,
  personCameraGesture,
} from "./camera-coordinator";

describe("camera coordination", () => {
  it("lets a direct gesture cancel application motion and blocks later automatic focus", () => {
    const fragment = coordinateCameraFocus(INITIAL_CAMERA_COORDINATION, {
      source: "fragment",
      target: "fragment-a",
      explicit: false,
    });
    expect(fragment.kind).toBe("accepted");
    if (fragment.kind !== "accepted") return;

    const gesture = personCameraGesture(fragment.state);
    expect(gesture.cancelActive).toBe(true);
    expect(gesture.state.owner).toBe("person");

    for (const source of ["location", "body", "fragment"] as const) {
      expect(
        coordinateCameraFocus(gesture.state, {
          source,
          target: source,
          explicit: false,
        }),
      ).toMatchObject({ kind: "blocked", reason: "person-owns-camera" });
    }
  });

  it("lets the newest explicit product action deliberately take control back", () => {
    const gesture = personCameraGesture(INITIAL_CAMERA_COORDINATION);

    const focus = coordinateCameraFocus(gesture.state, {
      source: "body",
      target: "body-camera",
      explicit: true,
    });

    expect(focus).toMatchObject({
      kind: "accepted",
      target: "body-camera",
      cancelActive: false,
      state: { owner: "application", active: { source: "body" } },
    });
  });

  it("does not let automatic narration interrupt an active application transition", () => {
    const location = coordinateCameraFocus(INITIAL_CAMERA_COORDINATION, {
      source: "location",
      target: "location-camera",
      explicit: false,
    });
    expect(location.kind).toBe("accepted");
    if (location.kind !== "accepted") return;

    expect(
      coordinateCameraFocus(location.state, {
        source: "fragment",
        target: "fragment-camera",
        explicit: false,
      }),
    ).toMatchObject({
      kind: "blocked",
      reason: "application-transition-active",
    });
  });

  it("retargets an active transition for the newest explicit location/body/fragment action", () => {
    const first = coordinateCameraFocus(INITIAL_CAMERA_COORDINATION, {
      source: "location",
      target: "location-camera",
      explicit: true,
    });
    expect(first.kind).toBe("accepted");
    if (first.kind !== "accepted") return;

    const second = coordinateCameraFocus(first.state, {
      source: "fragment",
      target: "fragment-camera",
      explicit: true,
    });

    expect(second).toMatchObject({
      kind: "accepted",
      target: "fragment-camera",
      cancelActive: true,
      state: { active: { source: "fragment", explicit: true } },
    });
  });

  it("ignores completion from a cancelled transition", () => {
    const first = coordinateCameraFocus(INITIAL_CAMERA_COORDINATION, {
      source: "location",
      target: "location-camera",
      explicit: true,
    });
    if (first.kind !== "accepted") throw new Error("expected accepted focus");
    const firstGeneration = first.state.active!.generation;

    const second = coordinateCameraFocus(first.state, {
      source: "body",
      target: "body-camera",
      explicit: true,
    });
    if (second.kind !== "accepted")
      throw new Error("expected retargeted focus");

    expect(completeCameraFocus(second.state, firstGeneration)).toEqual(
      second.state,
    );
    expect(
      completeCameraFocus(second.state, second.state.active!.generation),
    ).toEqual({
      owner: "unclaimed",
      generation: second.state.generation,
    });
  });
});
