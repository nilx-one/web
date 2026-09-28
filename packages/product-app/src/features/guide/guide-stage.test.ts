// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BODY_HANDOVER_ZOOM,
  mapCompassBearing,
  mapDistanceMeters,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  GUIDE_ENTRY_METERS,
  GUIDE_MAX_PITCH,
  GUIDE_STAND_METERS,
  GUIDE_WALK_MS,
  guideModel,
  guideShotCamera,
  guideStage,
  sampleGuideBody,
  type GuideShot,
} from "./guide-stage";

const KYIV = { longitude: 30.5234, latitude: 50.4501 };

describe("where a scene with 0xda-sha is staged", () => {
  const stage = guideStage(KYIV);

  it("stands her just in front of the Bond, who faces north", () => {
    expect(mapDistanceMeters(stage.you, stage.dasha)).toBeCloseTo(
      GUIDE_STAND_METERS,
      1,
    );
    expect(mapCompassBearing(stage.you, stage.dasha)).toBeCloseTo(0, 0);
    expect(mapDistanceMeters(stage.you, stage.entry)).toBeCloseTo(
      GUIDE_ENTRY_METERS,
      0,
    );
  });

  it("frames every shot close enough for both bodies to be drawn", () => {
    const shots: GuideShot[] = [
      "establish",
      "two-shot",
      "dasha",
      "you",
      "reward",
    ];
    for (const shot of shots) {
      const camera = guideShotCamera(shot, stage);
      expect(camera.zoom).toBeGreaterThanOrEqual(MAP_BODY_HANDOVER_ZOOM);
      expect(camera.pitch).toBeLessThanOrEqual(GUIDE_MAX_PITCH);
    }
  });

  it("looks at whoever is speaking over the other's shoulder", () => {
    // Her face is to the south, so the camera looks north at her…
    expect(guideShotCamera("dasha", stage).bearing).toBeLessThan(45);
    // …and the Bond faces north, so its reply is filmed looking south.
    const reverse = guideShotCamera("you", stage).bearing;
    expect(reverse).toBeGreaterThan(135);
    expect(reverse).toBeLessThan(225);
  });

  it("walks her in, then turns her to face the Bond", () => {
    const walk = {
      kind: "walk" as const,
      from: stage.entry,
      to: stage.dasha,
      startedMs: 0,
      durationMs: GUIDE_WALK_MS,
    };
    const halfway = sampleGuideBody(walk, GUIDE_WALK_MS / 2, false);
    expect(halfway.clipId).toBe("walk");
    expect(halfway.moving).toBe(true);
    const arrived = sampleGuideBody(walk, GUIDE_WALK_MS, false);
    expect(mapDistanceMeters(arrived.point, stage.dasha)).toBeLessThan(0.01);
    expect(arrived.clipId).toBe("idle");

    const standing = sampleGuideBody(
      { kind: "stand", at: stage.dasha, facing: stage.you },
      GUIDE_WALK_MS,
      false,
    );
    expect(standing.bearingDeg).toBeCloseTo(180, 0);
  });

  it("has her simply standing there for a person who asked for less motion", () => {
    const pose = sampleGuideBody(
      {
        kind: "walk",
        from: stage.entry,
        to: stage.dasha,
        startedMs: 0,
        durationMs: GUIDE_WALK_MS,
      },
      0,
      true,
    );
    expect(pose.clipId).toBe("idle");
    expect(mapDistanceMeters(pose.point, stage.dasha)).toBeLessThan(0.01);
  });

  it("never draws her in the body the Bond is wearing", () => {
    expect(guideModel("sky-study")).toBe("dasha-v2-study");
    expect(guideModel(undefined)).toBe("dasha-v2-study");
    expect(guideModel("dasha-v2-study")).toBe("dasha-study");
  });
});
