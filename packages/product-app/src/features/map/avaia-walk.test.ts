// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { mapDistanceMeters } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  approachPoint,
  JOG_AFTER_METERS,
  JOG_SPEED_MPS,
  locomotionMode,
  locomotionStepMs,
  MIN_WALK_SPEED_MPS,
  RUN_AFTER_METERS,
  RUN_SPEED_MPS,
  startWalk,
  studyFinished,
  studyStance,
  STUDY_MS,
  walkArrived,
  walkBearing,
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
const metresEast = (meters: number) => ({
  longitude:
    here.longitude +
    meters / (111_195 * Math.cos((here.latitude * Math.PI) / 180)),
  latitude: here.latitude,
});

describe("Avaia walking", () => {
  it("faces where it was sent, as a compass reads it", () => {
    expect(
      startWalk({ from: here, to: north, nowMs: 0, zoom: 17 }).bearingDeg,
    ).toBeCloseTo(0, 0);
    expect(
      startWalk({ from: here, to: east, nowMs: 0, zoom: 17 }).bearingDeg,
    ).toBeCloseTo(90, 0);
  });

  it("follows a route's turns, facing along each leg in turn", () => {
    // East, then north: an L round a corner.
    const corner = east;
    const beyond = { longitude: east.longitude, latitude: north.latitude };
    const walk = startWalk({
      from: here,
      to: beyond,
      path: [here, corner, beyond],
      nowMs: 0,
      zoom: 17,
    });
    const legs = [
      mapDistanceMeters(here, corner),
      mapDistanceMeters(corner, beyond),
    ];
    const total = legs[0]! + legs[1]!;
    const atCorner = (walk.durationMs * legs[0]!) / total;

    expect(walk.durationMs).toBeCloseTo(
      (total / walkSpeedMetersPerSecond(here.latitude, 17)) * 1_000,
      3,
    );
    expect(walkBearing(walk, atCorner / 2)).toBeCloseTo(90, 0);
    expect(walkBearing(walk, (atCorner + walk.durationMs) / 2)).toBeCloseTo(
      0,
      0,
    );
    expect(walk.arrivalBearingDeg).toBeCloseTo(0, 0);
    const turning = walkPosition(walk, atCorner);
    expect(mapDistanceMeters(turning, corner)).toBeLessThan(0.01);
    // Halfway down the second leg is off the straight line between the ends.
    const second = walkPosition(walk, (atCorner + walk.durationMs) / 2);
    expect(second.longitude).toBeCloseTo(corner.longitude, 9);
    expect(walkPosition(walk, walk.durationMs)).toEqual(beyond);
  });

  it("takes as long as the distance at a physical walking pace", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 1_000, zoom: 17 });
    const speed = walkSpeedMetersPerSecond(here.latitude, 17);

    expect(walk.durationMs).toBeCloseTo(
      (mapDistanceMeters(here, east) / speed) * 1_000,
      3,
    );
    expect(walkArrived(walk, 1_000 + walk.durationMs - 1)).toBe(false);
    expect(walkArrived(walk, 1_000 + walk.durationMs)).toBe(true);
  });

  it("keeps the same human walking pace at every camera zoom", () => {
    expect(walkSpeedMetersPerSecond(50, 15)).toBe(MIN_WALK_SPEED_MPS);
    expect(walkSpeedMetersPerSecond(50, 17)).toBe(MIN_WALK_SPEED_MPS);
    expect(walkSpeedMetersPerSecond(50, 30)).toBe(MIN_WALK_SPEED_MPS);
  });

  it("walks nearby, jogs after 400 m, and runs only when a long route allows it", () => {
    expect(locomotionMode(JOG_AFTER_METERS, "run")).toBe("walk");
    expect(locomotionMode(JOG_AFTER_METERS + 1, "run")).toBe("jog");
    expect(locomotionMode(RUN_AFTER_METERS + 1, "jog")).toBe("jog");
    expect(locomotionMode(RUN_AFTER_METERS + 1, "run")).toBe("run");
    expect(locomotionMode(RUN_AFTER_METERS + 1, "walk")).toBe("walk");
  });

  it("keeps footfalls in human-scale ground distance for every gait", () => {
    expect(MIN_WALK_SPEED_MPS * (locomotionStepMs("walk") / 1_000)).toBeCloseTo(
      0.84,
      2,
    );
    expect(JOG_SPEED_MPS * (locomotionStepMs("jog") / 1_000)).toBeCloseTo(
      1.08,
      2,
    );
    expect(RUN_SPEED_MPS * (locomotionStepMs("run") / 1_000)).toBeCloseTo(
      1.296,
      2,
    );
  });

  it("takes about a minute to cover 100 m instead of skating across it", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 0, zoom: 15 });
    const meters = mapDistanceMeters(here, east);

    expect(meters).toBeGreaterThan(90);
    expect(meters).toBeLessThan(110);
    expect(walk.durationMs).toBeGreaterThan(60_000);
    expect(walk.durationMs).toBeLessThan(90_000);
  });

  it("selects and times the gait from distance and route allowance", () => {
    const jog = startWalk({
      from: here,
      to: metresEast(500),
      nowMs: 0,
      zoom: 10,
      maxLocomotion: "run",
    });
    expect(jog.mode).toBe("jog");
    expect(jog.durationMs).toBeCloseTo((500 / JOG_SPEED_MPS) * 1_000, -2);

    const run = startWalk({
      from: here,
      to: metresEast(1_500),
      nowMs: 0,
      zoom: 20,
      maxLocomotion: "run",
    });
    expect(run.mode).toBe("run");
    expect(run.durationMs).toBeCloseTo((1_500 / RUN_SPEED_MPS) * 1_000, -2);
  });

  it("moves about one human step between footfalls", () => {
    const walk = startWalk({ from: here, to: east, nowMs: 0, zoom: 17 });
    const afterOneStep = walkPosition(walk, WALK_CLIP_MS / 2);

    expect(mapDistanceMeters(here, afterOneStep)).toBeCloseTo(
      MIN_WALK_SPEED_MPS * (WALK_CLIP_MS / 2 / 1_000),
      1,
    );
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
