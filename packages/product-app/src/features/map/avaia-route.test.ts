// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapObstacle,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { planRoute, routeBounds } from "./avaia-route";

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

/** A box from (x0, y0) to (x1, y1) in metres, as the renderer would hand it. */
function box(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly (readonly [number, number])[] {
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)].map(
    (point) => [point.longitude, point.latitude] as const,
  );
}

function building(...polygons: MapObstacle["polygons"][number][]): MapObstacle {
  return { kind: "building", polygons };
}

/** Whether a point `x`, `y` metres from the origin lies inside the box. */
function insideBox(
  point: MapPointSelection,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
): boolean {
  const x = (point.longitude - origin.longitude) * metersPerDegreeLng;
  const y = (point.latitude - origin.latitude) * metersPerDegreeLat;
  return x > x0 && x < x1 && y > y0 && y < y1;
}

/** Samples every leg densely and says whether any sample is inside the box. */
function crosses(
  path: readonly MapPointSelection[],
  area: readonly [number, number, number, number],
): boolean {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    for (let s = 0; s <= 200; s++) {
      const point = {
        longitude: a.longitude + ((b.longitude - a.longitude) * s) / 200,
        latitude: a.latitude + ((b.latitude - a.latitude) * s) / 200,
      };
      if (insideBox(point, area)) return true;
    }
  }
  return false;
}

function length(path: readonly MapPointSelection[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    meters += mapDistanceMeters(path[i - 1]!, path[i]!);
  }
  return meters;
}

describe("finding a way round", () => {
  it("goes straight when nothing stands in the way", () => {
    const route = planRoute(at(0, 0), at(60, 0), [
      building([box(20, 10, 40, 30)]),
    ]);
    expect(route).toEqual({ kind: "route", path: [at(0, 0), at(60, 0)] });
  });

  it("walks around a building rather than through it", () => {
    const house = [20, -10, 40, 10] as const;
    const route = planRoute(at(0, 0), at(60, 0), [building([box(...house)])]);

    expect(route.kind).toBe("route");
    if (route.kind !== "route") return;
    expect(route.path[0]).toEqual(at(0, 0));
    expect(route.path[route.path.length - 1]).toEqual(at(60, 0));
    expect(crosses(route.path, house)).toBe(false);
    // Taut, not cell by cell: a handful of turns, not far off the shortest
    // way round the corner (about 2 × √(20² + 10²) ≈ 44.7 m + 20 m).
    expect(route.path.length).toBeLessThanOrEqual(6);
    expect(length(route.path)).toBeLessThan(72);
  });

  it("cuts through a courtyard, which is open ground", () => {
    const outer = box(-20, -20, 20, 20);
    const yard = box(-8, -8, 8, 8);
    const route = planRoute(at(0, 0), at(0, 5), [building([outer, yard])]);
    expect(route).toEqual({ kind: "route", path: [at(0, 0), at(0, 5)] });
  });

  it("walks out of the building it is standing in", () => {
    // A phone indoors puts the body inside its own house; it is not trapped.
    const route = planRoute(at(0, 0), at(40, 0), [
      building([box(-10, -10, 10, 10)]),
    ]);
    expect(route.kind).toBe("route");
  });

  it("stops at the nearest open ground when sent inside a building", () => {
    const house = [20, -10, 40, 10] as const;
    const route = planRoute(at(0, 0), at(24, 0), [building([box(...house)])]);

    expect(route.kind).toBe("route");
    if (route.kind !== "route") return;
    const end = route.path[route.path.length - 1]!;
    expect(insideBox(end, house)).toBe(false);
    expect(mapDistanceMeters(end, at(20, 0))).toBeLessThan(3);
  });

  it("names what walls a place in when there is no way round", () => {
    // A closed ring of water around the destination.
    const moat: MapObstacle = {
      kind: "water",
      polygons: [[box(30, -30, 90, 30), box(40, -20, 80, 20)]],
    };
    expect(planRoute(at(0, 0), at(60, 0), [moat])).toEqual({
      kind: "blocked",
      by: "water",
    });
  });

  it("asks for obstacles in a box with room to detour", () => {
    const bounds = routeBounds(at(0, 0), at(100, 0));
    expect(bounds.west).toBeLessThan(at(-49, 0).longitude);
    expect(bounds.east).toBeGreaterThan(at(149, 0).longitude);
    expect(bounds.south).toBeLessThan(at(0, -49).latitude);
    expect(bounds.north).toBeGreaterThan(at(0, 49).latitude);
  });
});
