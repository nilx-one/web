// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BODY_HANDOVER_ZOOM,
  mapCompassBearing,
  mapDistanceMeters,
  type MapObstacle,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  GUIDE_ENTRY_METERS,
  GUIDE_MAX_PITCH,
  GUIDE_STAND_METERS,
  GUIDE_WALK_MS,
  clearShot,
  guideModel,
  guideShotCamera,
  guideSightlines,
  guideStage,
  offsetPoint,
  OPEN_GROUND,
  sampleGuideBody,
  shotIsClear,
  type GuideShot,
} from "./guide-stage";

const KYIV = { longitude: 30.5234, latitude: 50.4501 };

describe("where a scene with xSasha is staged", () => {
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

describe("a shot is never filmed through a wall", () => {
  const stage = guideStage(KYIV);
  const VIEWPORT = 800;

  /** A block `width` × `depth` metres, its near face `from` metres away. */
  function block(
    bearing: number,
    from: number,
    depth: number,
    width: number,
    height: number,
    around: MapPointSelection = KYIV,
  ): MapObstacle {
    const side = bearing + 90;
    const corner = (along: number, across: number): [number, number] => {
      const p = offsetPoint(offsetPoint(around, bearing, along), side, across);
      return [p.longitude, p.latitude];
    };
    const ring = [
      corner(from, -width / 2),
      corner(from, width / 2),
      corner(from + depth, width / 2),
      corner(from + depth, -width / 2),
      corner(from, -width / 2),
    ];
    return { kind: "building", polygons: [[ring]], heights: [height] };
  }

  const within = (obstacles: readonly MapObstacle[]) => () => obstacles;

  it("keeps the written shot where nothing is built", () => {
    for (const shot of ["establish", "dasha", "you", "two-shot"] as const) {
      const camera = guideShotCamera(shot, stage);
      expect(clearShot(camera, stage, OPEN_GROUND, VIEWPORT)).toEqual(camera);
      expect(
        clearShot(camera, stage, guideSightlines(KYIV, undefined), VIEWPORT),
      ).toEqual(camera);
    }
  });

  it("turns round the two of them when a building stands behind the camera", () => {
    // Her close-up looks north-north-east, so its eye stands to the south.
    const camera = guideShotCamera("dasha", stage);
    const wall = guideSightlines(
      KYIV,
      within([block(camera.bearing + 180, 5, 12, 24, 18)]),
    );
    expect(shotIsClear(camera, stage, wall, VIEWPORT)).toBe(false);

    const reshot = clearShot(camera, stage, wall, VIEWPORT);
    expect(shotIsClear(reshot, stage, wall, VIEWPORT)).toBe(true);
    expect(reshot).not.toEqual(camera);
    // The nearest way round, not a leap to the other side of them.
    const turned = Math.abs(
      ((reshot.bearing - camera.bearing + 540) % 360) - 180,
    );
    expect(turned).toBeLessThan(90);
    expect(reshot.zoom).toBe(camera.zoom);
  });

  it("looks over what is too low to hide anyone", () => {
    const camera = guideShotCamera("dasha", stage);
    const kerb = guideSightlines(
      KYIV,
      within([block(camera.bearing + 180, 5, 3, 24, 0.5)]),
    );
    expect(clearShot(camera, stage, kerb, VIEWPORT)).toEqual(camera);
  });

  it("ignores water, which hides no one", () => {
    const camera = guideShotCamera("dasha", stage);
    const pond = block(camera.bearing + 180, 5, 12, 24, 18);
    const water = guideSightlines(
      KYIV,
      within([{ kind: "water", polygons: pond.polygons }]),
    );
    expect(clearShot(camera, stage, water, VIEWPORT)).toEqual(camera);
  });

  it("lets be a building the Bond is standing inside", () => {
    const camera = guideShotCamera("dasha", stage);
    const hall = guideSightlines(KYIV, within([block(180, -40, 80, 80, 20)]));
    expect(clearShot(camera, stage, hall, VIEWPORT)).toEqual(camera);
  });

  it("films from overhead when it is walled in on every side", () => {
    const camera = guideShotCamera("two-shot", stage);
    const courtyard = guideSightlines(
      KYIV,
      within([0, 90, 180, 270].map((bearing) => block(bearing, 6, 30, 60, 60))),
    );
    const reshot = clearShot(camera, stage, courtyard, VIEWPORT);
    expect(shotIsClear(reshot, stage, courtyard, VIEWPORT)).toBe(true);
    expect(reshot.pitch).toBeLessThan(camera.pitch);
  });
});
