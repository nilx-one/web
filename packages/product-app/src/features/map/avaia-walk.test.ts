// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { mapDistanceMeters } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  approachPoint,
  MIN_WALK_SPEED_MPS,
  startWalk,
  studyFinished,
  studyStance,
  STUDY_MS,
  walkArrived,
  walkPosition,
  walkSpeedMetersPerSecond,
  walkStance,
  WALK_CLIP_MS,
} from "./avaia-walk";

const here = { longitude: 30.5234, latitude: 50.4501 };
// About 100 m east of `here`.
const east = { longitude: 30.5248, latitude: 50.4501 };
// About 100 m north.
const north = { longitude: 30.5234, latitude: 50.451 };

describe("Avaia walking", () => {
  it("faces where it was sent, as a compass reads it", () => {
    expect(
      startWalk({ from: here, to: north, nowMs: 0, zoom: 17 }).bearingDeg,
    ).toBeCloseTo(0, 0);
    expect(
      startWalk({ from: here, to: east, nowMs: 0, zoom: 17 }).bearingDeg,
    ).toBeCloseTo(90, 0);
  });

  it("takes as long as the distance at the pace the scale sets", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 1_000, zoom: 17 });
    const speed = walkSpeedMetersPerSecond(here.latitude, 17);

    expect(walk.durationMs).toBeCloseTo(
      (mapDistanceMeters(here, east) / speed) * 1_000,
      3,
    );
    expect(walkArrived(walk, 1_000 + walk.durationMs - 1)).toBe(false);
    expect(walkArrived(walk, 1_000 + walk.durationMs)).toBe(true);
  });

  it("walks at a pace measured against the drawn body, never below a stroll", () => {
    // Further out a body covers more ground per drawn height, so it walks
    // faster on the ground to look the same pace on the screen.
    expect(walkSpeedMetersPerSecond(50, 15)).toBeGreaterThan(
      walkSpeedMetersPerSecond(50, 17),
    );
    expect(walkSpeedMetersPerSecond(50, 30)).toBe(MIN_WALK_SPEED_MPS);
  });

  it("is halfway there halfway through, and stays at the end once arrived", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 0, zoom: 17 });
    const half = walkPosition(walk, walk.durationMs / 2);

    expect(mapDistanceMeters(here, half)).toBeCloseTo(
      mapDistanceMeters(here, east) / 2,
      0,
    );
    expect(walkPosition(walk, walk.durationMs * 3)).toEqual(east);
  });

  it("loops the stride at the length the asset authored", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 0, zoom: 17 });

    expect(walkStance(walk, WALK_CLIP_MS / 4)).toMatchObject({
      clipId: "walk",
      clipPhase: 0.25,
    });
    expect(walkStance(walk, WALK_CLIP_MS * 2).clipPhase).toBe(0);
  });

  it("turns on the spot rather than walking nowhere", () => {
    expect(
      startWalk({ from: here, to: here, nowMs: 0, zoom: 17 }).durationMs,
    ).toBe(0);
  });

  it("stops in front of a landmark rather than inside it", () => {
    const stop = approachPoint(here, east, 4);

    expect(mapDistanceMeters(stop, east)).toBeCloseTo(4, 1);
    // Already closer than that: it stays where it is.
    expect(approachPoint(east, east, 4)).toEqual(east);
  });

  it("looks a landmark over for a while, then is done", () => {
    const study = {
      landmark: {
        id: "poi:1",
        longitude: east.longitude,
        latitude: east.latitude,
        kind: "monument",
        facts: {},
      },
      at: here,
      bearingDeg: 90,
      startedMs: 0,
    };

    expect(studyStance(study, 100)).toMatchObject({
      clipId: "turn_in_place",
      bearingDeg: 90,
      point: here,
    });
    expect(studyFinished(study, STUDY_MS - 1)).toBe(false);
    expect(studyFinished(study, STUDY_MS)).toBe(true);
  });
});
