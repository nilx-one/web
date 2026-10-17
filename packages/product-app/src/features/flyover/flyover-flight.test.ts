// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapObstacle } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  FLYOVER_CLEARANCE_METERS,
  FLYOVER_LANE_METERS,
  FLYOVER_LOW_HEIGHT_METERS,
  FLYOVER_MAX_LANE,
  FLYOVER_STEER_HOLD_MS,
  flightObstacles,
  flightPath,
  flightPoint,
  localFrame,
  pathAt,
  scanAhead,
  startFlight,
  steerFlight,
  stepFlight,
  type FlightObstacle,
  type FlightPath,
  type FlightState,
  type Point,
} from "./flyover-flight";

/** A block on the plane: `x` across the route, `y` along it, in metres. */
function block(
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  heightMeters: number,
): FlightObstacle {
  return {
    rings: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
    heightMeters,
    minX: x0,
    minY: y0,
    maxX: x1,
    maxY: y1,
  };
}

/** A straight route north, 1 km long. */
const north = flightPath([
  [0, 0],
  [0, 1_000],
]);

/** Flies frame by frame for `ms`, reading the roofs ahead every frame. */
function fly(
  path: FlightPath,
  obstacles: readonly FlightObstacle[],
  ms: number,
  from: FlightState = startFlight(path),
  startMs = 0,
  onFrame?: (state: FlightState, nowMs: number) => void,
): FlightState {
  let state = from;
  for (let now = startMs; now < startMs + ms; now += 16) {
    state = stepFlight(
      path,
      state,
      scanAhead(path, state.distance, obstacles),
      16,
      now + 16,
    );
    onFrame?.(state, now + 16);
  }
  return state;
}

describe("the flight path", () => {
  it("rounds corners, keeps both ends and measures its length", () => {
    const path = flightPath([
      [0, 0],
      [0, 100],
      [100, 100],
    ]);
    expect(path.points[0]).toEqual([0, 0]);
    expect(path.points[path.points.length - 1]).toEqual([100, 100]);
    expect(path.points.some(([x, y]) => x === 0 && y === 100)).toBe(false);
    expect(path.length).toBeGreaterThan(150);
    expect(path.length).toBeLessThan(200);
    expect(pathAt(path, path.length + 50).point).toEqual([100, 100]);
  });

  it("maps a city's coordinates to metres and back", () => {
    const frame = localFrame([30.4467, 50.4734]);
    const [x, y] = frame.toLocal([30.5131, 50.4489]);
    expect(Math.hypot(x, y)).toBeGreaterThan(5_000);
    expect(Math.hypot(x, y)).toBeLessThan(5_500);
    const [longitude, latitude] = frame.toLonLat([x, y]);
    expect(longitude).toBeCloseTo(30.5131, 9);
    expect(latitude).toBeCloseTo(50.4489, 9);
  });

  it("keeps buildings with a height and leaves water out", () => {
    const frame = localFrame([30.5, 50.45]);
    const ring = [
      [30.5, 50.45],
      [30.5001, 50.45],
      [30.5001, 50.4501],
      [30.5, 50.45],
    ] as const;
    const obstacles: MapObstacle[] = [
      { kind: "building", polygons: [[ring], [ring]], heights: [20, 0] },
      { kind: "water", polygons: [[ring]] },
    ];
    const buildings = flightObstacles(obstacles, frame);
    expect(buildings).toHaveLength(1);
    expect(buildings[0]?.heightMeters).toBe(20);
  });
});

describe("flying the route", () => {
  it("flies low over open ground and arrives at the end", () => {
    const end = fly(north, [], 40_000);
    expect(end.arrived).toBe(true);
    expect(end.distance).toBe(north.length);
    expect(end.height).toBeCloseTo(FLYOVER_LOW_HEIGHT_METERS, 0);
    expect(Math.abs(end.lateral)).toBeLessThan(0.5);
  });

  it("climbs over a building it can clear, ahead of reaching it", () => {
    const house = block(-30, 30, 300, 330, 25);
    let heightOver = 0;
    fly(north, [house], 12_000, undefined, 0, (state) => {
      if (state.distance >= 300 && state.distance <= 330)
        heightOver = Math.max(heightOver, state.height);
    });
    expect(heightOver).toBeGreaterThan(25 + FLYOVER_CLEARANCE_METERS - 2);
  });

  it("goes around a tower it cannot clear, then comes back to the route", () => {
    const tower = block(-6, 6, 400, 440, 120);
    let widest = 0;
    const touched: number[] = [];
    const end = fly(north, [tower], 30_000, undefined, 0, (state) => {
      widest = Math.max(widest, Math.abs(state.lateral));
      const [x, y] = flightPoint(north, state);
      if (y > 400 && y < 440 && Math.abs(x) < 6) touched.push(y);
    });
    expect(touched).toEqual([]);
    expect(widest).toBeGreaterThan(FLYOVER_LANE_METERS * 0.8);
    expect(Math.abs(end.lateral)).toBeLessThan(0.5);
  });

  it("flies higher over dense blocks than over open ground", () => {
    // Low roofs on both sides of the street, too low to climb for.
    const blocks = [-1, 1]
      .flatMap((side) =>
        Array.from({ length: 20 }, (_, index) =>
          block(side * 6, side * 40, index * 50, index * 50 + 40, 4),
        ),
      )
      .map((b) => (b.minX > b.maxX ? { ...b, minX: b.maxX, maxX: b.minX } : b));
    const dense = fly(north, blocks, 8_000);
    const open = fly(north, [], 8_000);
    expect(dense.height).toBeGreaterThan(open.height + 5);
  });

  it("banks into a turn and leans its nose into speed", () => {
    const corner = flightPath([
      [0, 0],
      [0, 200],
      [200, 200],
    ]);
    let rightBank = 0;
    fly(corner, [], 12_000, undefined, 0, (state) => {
      rightBank = Math.max(rightBank, state.rollDeg);
    });
    expect(rightBank).toBeGreaterThan(10);
    expect(fly(north, [], 2_000).pitchDeg).toBeGreaterThan(0);
  });
});

describe("at the wheel", () => {
  it("steps a lane aside, holds it, and is pulled back once let go", () => {
    const steered = steerFlight(startFlight(north), 1, 0);
    const held = fly(north, [], 1_000, steered, 0);
    expect(held.lateral).toBeGreaterThan(FLYOVER_LANE_METERS * 0.8);
    const back = fly(north, [], 3_000, held, 1_000);
    expect(Math.abs(back.lateral)).toBeLessThan(1);
  });

  it("never steers out of the corridor", () => {
    let state = startFlight(north);
    for (let step = 0; step < 6; step++) state = steerFlight(state, -1, step);
    expect(state.steerLane).toBe(-FLYOVER_MAX_LANE);
    const far = fly(north, [], FLYOVER_STEER_HOLD_MS - 100, state, 5);
    expect(far.lateral).toBeGreaterThan(
      -FLYOVER_MAX_LANE * FLYOVER_LANE_METERS - 1,
    );
  });

  it("goes around a building even when steered into it", () => {
    const tower: FlightObstacle = block(8, 20, 0, 1_000, 150);
    const steered = steerFlight(startFlight(north), 1, 0);
    const inside: Point[] = [];
    fly(north, [tower], 1_200, steered, 0, (state) => {
      const point = flightPoint(north, state);
      if (point[0] > 8 && point[0] < 20) inside.push(point);
    });
    expect(inside).toEqual([]);
  });
});
