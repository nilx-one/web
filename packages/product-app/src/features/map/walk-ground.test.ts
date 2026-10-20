// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapObstacle,
  MapPointSelection,
  MapRoad,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { planWalk } from "./avaia-path";
import {
  groundUnderTap,
  OVERHEAD_BASE_METERS,
  walkGround,
} from "./walk-ground";

// A small local frame in metres, east and north of a point in Kyiv.
const ORIGIN = { longitude: 30.56, latitude: 50.43 };
const KY = 111_195;
const KX = KY * Math.cos((ORIGIN.latitude * Math.PI) / 180);

function at(east: number, north: number): MapPointSelection {
  return {
    longitude: ORIGIN.longitude + east / KX,
    latitude: ORIGIN.latitude + north / KY,
  };
}

function lonLat(east: number, north: number): [number, number] {
  const point = at(east, north);
  return [point.longitude, point.latitude];
}

/** A square ring `half` metres either side of its centre, closed. */
function square(east: number, north: number, half: number) {
  return [
    lonLat(east - half, north - half),
    lonLat(east + half, north - half),
    lonLat(east + half, north + half),
    lonLat(east - half, north + half),
    lonLat(east - half, north - half),
  ];
}

function buildings(
  ...parts: { ring: [number, number][]; height: number; base?: number }[]
): MapObstacle {
  return {
    kind: "building",
    polygons: parts.map(({ ring }) => [ring]),
    heights: parts.map(({ height }) => height),
    bases: parts.map(({ base }) => base ?? 0),
  };
}

function path(
  kindDetail: string,
  ...points: (readonly [number, number])[]
): MapRoad {
  return {
    kind: "path",
    kindDetail,
    lines: [points.map(([e, n]) => lonLat(e, n))],
  };
}

const metresBetween = (a: MapPointSelection, b: MapPointSelection) =>
  Math.hypot((a.longitude - b.longitude) * KX, (a.latitude - b.latitude) * KY);

describe("terraces", () => {
  // A 7.5 m platform 40 m across, a footway around its top, and a flight of
  // steps coming up its east side from the street.
  const platform = { ring: square(0, 0, 20), height: 7.5 };
  const footway = path(
    "footway",
    [-15, -15],
    [15, -15],
    [15, 15],
    [-15, 15],
    [-15, -15],
  );
  const steps = path("steps", [32, 0], [20, 0]);

  it("leaves a building nobody walks across a wall", () => {
    const ground = walkGround([buildings(platform)], []);
    expect(ground.walls[0]?.polygons).toHaveLength(1);
    expect(ground.liftAt(at(0, 0))).toBe(0);
    expect(ground.onTerrace(at(0, 0))).toBe(false);
  });

  it("stands a body on top of a building a footway runs across", () => {
    const ground = walkGround([buildings(platform)], [footway]);
    expect(ground.onTerrace(at(0, 0))).toBe(true);
    expect(ground.liftAt(at(0, 0))).toBe(7.5);
    expect(ground.liftAt(at(40, 40))).toBe(0);
  });

  it("climbs a flight of steps from the street to the top", () => {
    const ground = walkGround([buildings(platform)], [footway, steps]);
    expect(ground.liftAt(at(32, 0))).toBeCloseTo(0);
    expect(ground.liftAt(at(26, 0))).toBeCloseTo(3.75);
    expect(ground.liftAt(at(20, 0))).toBeCloseTo(7.5);
  });

  it("gets a body up only by the steps, never up the wall", () => {
    const obstacles = [buildings(platform)];
    const roads = [footway, steps];
    const from = at(0, 40);
    const to = at(0, 10);
    const plan = planWalk({ from, to, roads, obstacles, chooser: "tap" });
    expect(plan.kind).toBe("route");
    if (plan.kind !== "route") return;
    // It arrives on the platform, having gone round by the east steps.
    expect(metresBetween(plan.path[plan.path.length - 1]!, to)).toBeLessThan(1);
    const ground = walkGround(obstacles, roads);
    const lifts = densify(plan.path).map((point) => ground.liftAt(point));
    for (let i = 1; i < lifts.length; i++) {
      expect(Math.abs(lifts[i]! - lifts[i - 1]!)).toBeLessThan(1.5);
    }
  });

  it("walks a tier of the same platform, not a tower standing on it", () => {
    const tier = { ring: square(-8, 0, 4), height: 13 };
    const tower = { ring: square(8, 0, 3), height: 40 };
    const ground = walkGround([buildings(platform, tier, tower)], [footway]);
    expect(ground.liftAt(at(-8, 0))).toBe(13);
    expect(ground.onTerrace(at(-8, 0))).toBe(true);
    expect(ground.onTerrace(at(8, 0))).toBe(false);
    const walls = ground.walls.flatMap((wall) => wall.heights ?? []);
    expect(walls).toContain(40);
    expect(walls).not.toContain(13);
  });

  it("walks under what is overhead", () => {
    const arm = {
      ring: square(0, 0, 3),
      height: 80,
      base: OVERHEAD_BASE_METERS + 60,
    };
    const ground = walkGround([buildings(arm)], []);
    expect(ground.walls).toEqual([]);
  });

  it("climbs a staircase the map draws as a building by its flight", () => {
    // OpenStreetMap often draws a monumental stair as a building part as
    // tall as the platform it climbs to.
    const staircase = { ring: square(26, 0, 6), height: 7.5 };
    const ground = walkGround(
      [buildings(platform, staircase)],
      [footway, steps],
    );
    expect(ground.liftAt(at(26, 0))).toBeCloseTo(3.75);
    // Off to one side of the flight, still on the staircase.
    expect(ground.liftAt(at(26, 4))).toBeCloseTo(3.75);
  });
});

describe("a tap on a terrace", () => {
  const platform = buildings({ ring: square(0, 0, 20), height: 7.5 });
  const footway = path("footway", [-15, 0], [15, 0]);
  const tap = { ...at(0, 5), ground: "building" as const };

  it("is open ground to walk to", () => {
    const renderer = {
      obstaclesWithin: () => [platform],
      roadsWithin: () => [footway],
    };
    expect(groundUnderTap(renderer, tap)).toBe("open");
  });

  it("is still a building where nobody walks", () => {
    const renderer = {
      obstaclesWithin: () => [platform],
      roadsWithin: () => [],
    };
    expect(groundUnderTap(renderer, tap)).toBe("building");
  });

  it("leaves every other ground as the renderer read it", () => {
    const renderer = { obstaclesWithin: () => [], roadsWithin: () => [] };
    expect(groundUnderTap(renderer, { ...tap, ground: "water" })).toBe("water");
  });
});

function densify(points: readonly MapPointSelection[]): MapPointSelection[] {
  const out: MapPointSelection[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const n = Math.max(1, Math.ceil(metresBetween(a, b) / 0.5));
    for (let s = 0; s < n; s++) {
      out.push({
        longitude: a.longitude + ((b.longitude - a.longitude) * s) / n,
        latitude: a.latitude + ((b.latitude - a.latitude) * s) / n,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}
