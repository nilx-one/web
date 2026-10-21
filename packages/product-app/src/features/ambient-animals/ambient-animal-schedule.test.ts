// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AMBIENT_ANIMAL_CLIPS } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  metersBetween,
  offsetMeters,
} from "../ambient-drones/ambient-drone-schedule";
import {
  ANIMAL_CLIP_SECONDS,
  ANIMAL_MAX_ON_GROUND,
  ANIMAL_SLOT_MS,
  EMPTY_GROUND,
  animalWaypoint,
  animalsAround,
  eaglesAround,
  habitatAt,
  sampleAnimal,
  sampleEagle,
  type AnimalGround,
} from "./ambient-animal-schedule";
import { groundWithin } from "./use-ambient-animals";

const KYIV: [number, number] = [30.52, 50.45];

/** A square `meters` on a side around a point, as one polygon. */
function square(centre: readonly [number, number], meters: number) {
  const [west] = offsetMeters(centre, meters / 2, Math.PI);
  const [east] = offsetMeters(centre, meters / 2, 0);
  const [, south] = offsetMeters(centre, meters / 2, -Math.PI / 2);
  const [, north] = offsetMeters(centre, meters / 2, Math.PI / 2);
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ] as [number, number][],
  ];
}

const park: AnimalGround = { ...EMPTY_GROUND, green: [square(KYIV, 400)] };
const lake: AnimalGround = { ...EMPTY_GROUND, water: [square(KYIV, 400)] };

describe("the ground an animal lives on", () => {
  it("reads water before green, and nothing inside a building", () => {
    const ground: AnimalGround = {
      green: [square(KYIV, 100)],
      water: [square(KYIV, 20)],
      buildings: [square(offsetMeters(KYIV, 35, 0), 10)],
      paths: [[offsetMeters(KYIV, 300, Math.PI), offsetMeters(KYIV, 300, 0)]],
    };
    expect(habitatAt(ground, KYIV)).toBe("water");
    expect(habitatAt(ground, offsetMeters(KYIV, 20, Math.PI / 2))).toBe(
      "green",
    );
    expect(habitatAt(ground, offsetMeters(KYIV, 35, 0))).toBeUndefined();
    // Open ground beside the park: on the footway, then off it.
    const by = offsetMeters(KYIV, 120, 0);
    expect(habitatAt(ground, by)).toBe("path");
    expect(
      habitatAt(ground, offsetMeters(by, 30, Math.PI / 2)),
    ).toBeUndefined();
  });
});

describe("who lives where", () => {
  it("keeps squirrels to the green, and fish to the water", () => {
    const inPark = animalsAround(KYIV, 180, park, 500);
    expect(inPark.length).toBeGreaterThan(20);
    expect(new Set(inPark.map((a) => a.kind))).toEqual(
      new Set(["squirrel", "dog", "cat"]),
    );
    const squirrels = inPark.filter((a) => a.kind === "squirrel").length;
    expect(squirrels / inPark.length).toBeGreaterThan(0.55);

    const inLake = animalsAround(KYIV, 180, lake, 500);
    expect(inLake.length).toBeGreaterThan(5);
    expect(inLake.every((a) => a.kind === "piranha")).toBe(true);

    expect(animalsAround(KYIV, 180, EMPTY_GROUND, 500)).toHaveLength(0);
  });

  it("is the same city on every device, nearest first and capped", () => {
    const first = animalsAround(KYIV, 180, park);
    const again = animalsAround(KYIV, 180, park);
    expect(again).toEqual(first);
    expect(first).toHaveLength(ANIMAL_MAX_ON_GROUND);
    const distances = first.map((a) => metersBetween(KYIV, a.home));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    // A spot belongs to its cell, not to where the camera stands.
    const moved = animalsAround(offsetMeters(KYIV, 30, 0), 180, park, 500);
    const all = animalsAround(KYIV, 180, park, 500);
    const shared = moved.filter((a) => all.some((b) => b.id === a.id));
    for (const animal of shared)
      expect(animal).toEqual(all.find((b) => b.id === animal.id));
  });
});

describe("an animal through its day", () => {
  const ground: AnimalGround = { ...EMPTY_GROUND, green: [square(KYIV, 60)] };
  const animals = animalsAround(KYIV, 60, ground, 50);

  it("wanders without ever leaving its ground", () => {
    expect(animals.length).toBeGreaterThan(0);
    for (const animal of animals)
      for (let slot = 0; slot < 200; slot++)
        expect(habitatAt(ground, animalWaypoint(animal, slot, ground))).toBe(
          animal.habitat,
        );
  });

  it("moves on continuously from one slot into the next", () => {
    for (const animal of animals) {
      const edge = 40 * ANIMAL_SLOT_MS - animal.offsetMs;
      const before = sampleAnimal(animal, edge - 1, ground).lngLat;
      const after = sampleAnimal(animal, edge, ground).lngLat;
      expect(metersBetween(before, after)).toBeLessThan(0.05);
    }
  });

  it("plays only clips its own kind carries", () => {
    for (const animal of animals)
      for (let time = 0; time < 120_000; time += 700) {
        const handle = sampleAnimal(animal, time, ground);
        expect(handle.kind).toBe(animal.kind);
        expect(AMBIENT_ANIMAL_CLIPS[animal.kind]).toContain(handle.clipId);
        expect(handle.clipPhase).toBeGreaterThanOrEqual(0);
        expect(handle.clipPhase).toBeLessThan(1);
      }
    for (const [kind, clips] of Object.entries(AMBIENT_ANIMAL_CLIPS))
      expect(
        Object.keys(
          ANIMAL_CLIP_SECONDS[kind as keyof typeof ANIMAL_CLIP_SECONDS],
        ).sort(),
      ).toEqual([...clips].sort());
  });
});

describe("an eagle overhead", () => {
  it("circles high over its hub, facing the way it flies", () => {
    const eagles = eaglesAround(KYIV, 3_000);
    expect(eagles.length).toBeGreaterThan(0);
    for (const eagle of eagles) {
      const now = sampleEagle(eagle, 50_000);
      const next = sampleEagle(eagle, 50_200);
      expect(now.kind).toBe("eagle");
      expect(now.clipId).toBe("fly");
      expect(now.heightMeters).toBeGreaterThanOrEqual(35);
      expect(now.heightMeters).toBeLessThanOrEqual(60);
      expect(metersBetween(now.lngLat, eagle.hub)).toBeCloseTo(
        eagle.ringMeters,
        0,
      );
      const east =
        (next.lngLat[0] - now.lngLat[0]) *
        Math.cos((now.lngLat[1] * Math.PI) / 180);
      const north = next.lngLat[1] - now.lngLat[1];
      const flown = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
      const off = Math.abs(((flown - now.bearingDeg + 540) % 360) - 180);
      expect(off).toBeLessThan(3);
    }
  });
});

describe("the ground from a renderer", () => {
  it("splits obstacles, keeps green areas and only the footways", () => {
    const polygon = square(KYIV, 10);
    const ground = groundWithin(
      {
        obstaclesWithin: () => [
          { kind: "building", polygons: [polygon] },
          { kind: "water", polygons: [polygon, polygon] },
        ],
        greenAreasWithin: () => [{ kind: "park", polygon }],
        roadsWithin: () => [
          { kind: "path", lines: [[KYIV, KYIV]] },
          { kind: "major_road", lines: [[KYIV, KYIV]] },
        ],
      },
      { west: 30, east: 31, south: 50, north: 51 },
    );
    expect(ground.buildings).toHaveLength(1);
    expect(ground.water).toHaveLength(2);
    expect(ground.green).toEqual([polygon]);
    expect(ground.paths).toHaveLength(1);
    // A renderer that cannot answer leaves the world empty of animals.
    expect(
      groundWithin({}, { west: 30, east: 31, south: 50, north: 51 }),
    ).toEqual(EMPTY_GROUND);
  });
});
