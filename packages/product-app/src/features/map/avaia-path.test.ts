// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapObstacle,
  type MapPointSelection,
  type MapRoad,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { planWalk, type WalkChooser } from "./avaia-path";
import { planRoute } from "./avaia-route";

const origin = { longitude: 30.5234, latitude: 50.4501 };
const metersPerDegreeLat = 111_195;
const metersPerDegreeLng =
  metersPerDegreeLat * Math.cos((origin.latitude * Math.PI) / 180);

/** A point `x` metres east and `y` metres north of the origin. */
function at(x: number, y: number): MapPointSelection {
  return {
    longitude: origin.longitude + x / metersPerDegreeLng,
    latitude: origin.latitude + y / metersPerDegreeLat,
  };
}

function line(...points: (readonly [number, number])[]): [number, number][] {
  return points.map(([x, y]) => {
    const p = at(x, y);
    return [p.longitude, p.latitude];
  });
}

function footway(...points: (readonly [number, number])[]): MapRoad {
  return { kind: "path", kindDetail: "footway", lines: [line(...points)] };
}

function building(x0: number, y0: number, x1: number, y1: number): MapObstacle {
  return {
    kind: "building",
    polygons: [[line([x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0])]],
  };
}

function walk(
  from: MapPointSelection,
  to: MapPointSelection,
  roads: readonly MapRoad[],
  chooser: WalkChooser,
  obstacles: readonly MapObstacle[] = [],
) {
  return planWalk({ from, to, roads, obstacles, chooser });
}

function meters(path: readonly MapPointSelection[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += mapDistanceMeters(path[i - 1]!, path[i]!);
  }
  return total;
}

function routeOf(result: ReturnType<typeof planWalk>) {
  if (result.kind !== "route") throw new Error(`blocked by ${result.by}`);
  return result.path;
}

/** Whether the walk keeps within `tolerance` metres of y = `y` between its ends. */
function followsY(
  path: readonly MapPointSelection[],
  y: number,
  tolerance = 1,
): boolean {
  return path
    .slice(1, -1)
    .every(
      (point) =>
        Math.abs((point.latitude - origin.latitude) * metersPerDegreeLat - y) <
        tolerance,
    );
}

describe("planWalk", () => {
  it("crosses open ground as before when the map has no paths", () => {
    const from = at(0, 0);
    const to = at(100, 0);
    expect(walk(from, to, [], "tap")).toEqual(planRoute(from, to, []));
  });

  it("steps onto a nearby footway and follows it", () => {
    const path = routeOf(
      walk(at(0, 5), at(200, 5), [footway([-10, 0], [210, 0])], "own"),
    );
    expect(path[0]).toEqual(at(0, 5));
    expect(path.at(-1)).toEqual(at(200, 5));
    expect(followsY(path, 0)).toBe(true);
    expect(meters(path)).toBeCloseTo(210, 0);
  });

  it("crosses open ground when no line is within reach", () => {
    const from = at(0, 0);
    const to = at(100, 0);
    const far = footway([-10, 40], [110, 40]);
    expect(walk(from, to, [far], "own")).toEqual(planRoute(from, to, []));
  });

  describe("a footway that loops far round", () => {
    const loop = footway([0, 0], [0, -160], [100, -160], [100, 0]);

    it("is cut across when the owner points", () => {
      const path = routeOf(walk(at(0, 0), at(100, 0), [loop], "tap"));
      expect(meters(path)).toBeCloseTo(100, 0);
    });

    it("is kept to when the Avaia chooses: the cut is too long", () => {
      const path = routeOf(walk(at(0, 0), at(100, 0), [loop], "own"));
      expect(meters(path)).toBeCloseTo(420, 0);
    });
  });

  it("takes a short cut on its own when it saves enough", () => {
    const loop = footway([0, 0], [0, -20], [50, -20], [50, 0]);
    const path = routeOf(walk(at(0, 0), at(50, 0), [loop], "own"));
    expect(meters(path)).toBeCloseTo(50, 0);
  });

  it("keeps to the footway when the cut saves too little", () => {
    const loop = footway([0, 0], [0, -10], [50, -10], [50, 0]);
    const path = routeOf(walk(at(0, 0), at(50, 0), [loop], "own"));
    expect(meters(path)).toBeCloseTo(70, 0);
  });

  it("prefers the footway to a long way across the grass for a tap too", () => {
    const loop = footway([0, 0], [0, -40], [100, -40], [100, 0]);
    const path = routeOf(walk(at(0, 0), at(100, 0), [loop], "tap"));
    expect(meters(path)).toBeCloseTo(180, 0);
  });

  it("goes round a building on the way onto the footway", () => {
    const path = routeOf(
      walk(at(0, 20), at(200, 0), [footway([-10, 0], [210, 0])], "own", [
        building(-5, 5, 5, 15),
      ]),
    );
    for (const point of path) {
      const x = (point.longitude - origin.longitude) * metersPerDegreeLng;
      const y = (point.latitude - origin.latitude) * metersPerDegreeLat;
      expect(x > -5 && x < 5 && y > 5 && y < 15).toBe(false);
    }
  });

  it("finds the footway way round when open ground is shut", () => {
    // Water from wall to wall between the two ends, a footbridge over it.
    const water: MapObstacle = {
      kind: "water",
      polygons: [
        [line([-300, 20], [300, 20], [300, 40], [-300, 40], [-300, 20])],
      ],
    };
    const bridge: MapRoad = {
      kind: "path",
      kindDetail: "footway",
      isBridge: true,
      lines: [line([0, 10], [0, 50])],
    };
    expect(planRoute(at(0, 0), at(0, 60), [water]).kind).toBe("blocked");
    const path = routeOf(walk(at(0, 0), at(0, 60), [bridge], "tap", [water]));
    expect(meters(path)).toBeCloseTo(60, 0);
  });

  it("gives the same walk for the same input", () => {
    const roads = [footway([-10, 0], [210, 0]), footway([100, 0], [100, 50])];
    expect(walk(at(0, 5), at(100, 60), roads, "own")).toEqual(
      walk(at(0, 5), at(100, 60), roads, "own"),
    );
  });
});
