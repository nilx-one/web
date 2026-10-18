// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { buildWalkGraph, type LonLat } from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";
import {
  AMBIENT_ROOFTOP_METERS,
  ambientRoads,
  arrivalOf,
  heightAlong,
  planAmbientLeg,
  sampleAmbientLeg,
  turnBetween,
} from "./ambient-drone-flight";
import { metersBetween } from "./ambient-drone-schedule";

const ORIGIN: LonLat = [30.52, 50.45];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];

// An L of footway: 200 m east, then 200 m north.
const yard = buildWalkGraph([
  {
    kind: "path",
    kindDetail: "footway",
    lines: [[at(0, 0), at(200, 0), at(200, 200)]],
  },
]);

const hovering = (hover: number) => ({ leg: 0, hover, flight: 0 });
const flying = (flight: number) => ({ leg: 0, hover: 1, flight });

describe("an ambient drone's leg", () => {
  it("follows the graph between its waypoints, low the whole way", () => {
    const leg = planAmbientLeg(at(0, 5), at(205, 200), yard);
    expect(leg.routed).toBe(true);
    // Along the L, corners rounded, not across the 283 m diagonal.
    expect(leg.path.length).toBeGreaterThan(350);
    const corner = sampleAmbientLeg(leg, flying(0.5), 10);
    expect(metersBetween(corner.lngLat, at(200, 0))).toBeLessThan(40);
    for (const f of [0, 0.1, 0.5, 0.9, 1])
      expect(sampleAmbientLeg(leg, flying(f), 10).heightMeters).toBeCloseTo(10);
  });

  it("crosses straight over the roofs where the map has no roads", () => {
    const leg = planAmbientLeg(at(0, 0), at(200, 200), undefined);
    expect(leg.routed).toBe(false);
    const middle = sampleAmbientLeg(leg, flying(0.5), 10);
    expect(middle.heightMeters).toBeCloseTo(AMBIENT_ROOFTOP_METERS);
    expect(metersBetween(middle.lngLat, at(100, 100))).toBeLessThan(2);
    expect(middle.bearingDeg).toBeCloseTo(45, 0);
    expect(heightAlong(leg, 0, 10)).toBeCloseTo(AMBIENT_ROOFTOP_METERS);
  });

  it("comes down to the graph from a waypoint inside a block, and back up", () => {
    // Both waypoints stand 80 m off the footway, in the middle of blocks.
    const leg = planAmbientLeg(at(-80, 0), at(200, 280), yard);
    expect(leg.routed).toBe(true);
    expect(heightAlong(leg, 0, 10)).toBeCloseTo(AMBIENT_ROOFTOP_METERS);
    expect(heightAlong(leg, leg.path.length, 10)).toBeCloseTo(
      AMBIENT_ROOFTOP_METERS,
    );
    expect(heightAlong(leg, leg.path.length / 2, 10)).toBeCloseTo(10);
  });

  it("goes over the roofs rather than take a long detour", () => {
    // Reaching (0, 200) by the U is 600 m for a 200 m crossing.
    const u = buildWalkGraph([
      {
        kind: "path",
        kindDetail: "footway",
        lines: [[at(0, 0), at(200, 0), at(200, 200), at(0, 200)]],
      },
    ]);
    expect(planAmbientLeg(at(0, 0), at(0, 200), u).routed).toBe(false);
  });

  it("starts where the last leg ended and settles to its height in the hover", () => {
    const first = planAmbientLeg(at(0, 0), at(200, 200), undefined);
    const second = planAmbientLeg(at(200, 200), at(205, 0), yard);
    const arrived = sampleAmbientLeg(first, flying(1), 12);
    const arrival = arrivalOf(first, 12);
    const hover = sampleAmbientLeg(second, hovering(0), 12, arrival);
    expect(metersBetween(arrived.lngLat, hover.lngLat)).toBeLessThan(0.01);
    expect(arrived.heightMeters).toBeCloseTo(AMBIENT_ROOFTOP_METERS);
    expect(hover.heightMeters).toBeCloseTo(arrived.heightMeters);
    expect(hover.bearingDeg).toBeCloseTo(arrived.bearingDeg, 3);
    // By the end of the hover it has come down to the footway and turned to
    // the way ahead, the short way round.
    const settled = sampleAmbientLeg(second, hovering(1), 12, arrival);
    expect(settled.heightMeters).toBeCloseTo(12);
    expect(settled.bearingDeg).toBeCloseTo(second.startBearingDeg, 3);
    const early = sampleAmbientLeg(second, flying(0.02), 12);
    expect(metersBetween(early.lngLat, at(200, 200))).toBeLessThan(2);
  });

  it("banks into a bend and leans into speed, level when hovering", () => {
    const leg = planAmbientLeg(at(0, 5), at(205, 200), yard);
    const hover = sampleAmbientLeg(leg, hovering(0.5), 10);
    expect(hover.rollDeg).toBe(0);
    expect(hover.pitchDeg).toBe(0);
    // East, then a left turn to north: the left side goes down.
    const bend = sampleAmbientLeg(leg, flying(0.5), 10);
    expect(bend.rollDeg).toBeLessThan(-3);
    expect(bend.pitchDeg).toBeGreaterThan(3);
  });

  it("keeps a yard scout off the roads cars use, and a street drone on them", () => {
    // A straight avenue from (0, 0) to (300, 0), and a footway around it
    // through a courtyard lane: (0, 0) up to (0, 60), along to (300, 60),
    // down to (300, 0).
    const roads = [
      {
        kind: "major_road",
        kindDetail: "primary",
        lines: [[at(0, 0), at(300, 0)]],
      },
      {
        kind: "path",
        kindDetail: "footway",
        lines: [[at(0, 0), at(0, 60), at(150, 60)]],
      },
      {
        kind: "minor_road",
        kindDetail: "service",
        lines: [[at(150, 60), at(300, 60), at(300, 0)]],
      },
      {
        kind: "minor_road",
        kindDetail: "residential",
        lines: [[at(0, -80), at(300, -80)]],
      },
    ];
    expect(ambientRoads("yard", roads).map((road) => road.kindDetail)).toEqual([
      "footway",
      "service",
    ]);
    expect(
      ambientRoads("street", roads).map((road) => road.kindDetail),
    ).toEqual(["primary", "service", "residential"]);
    const scout = planAmbientLeg(
      at(0, 0),
      at(300, 0),
      buildWalkGraph(ambientRoads("yard", roads)),
    );
    expect(scout.routed).toBe(true);
    // Through the courtyard, never along the avenue.
    expect(
      metersBetween(
        sampleAmbientLeg(scout, flying(0.5), 10).lngLat,
        at(150, 60),
      ),
    ).toBeLessThan(15);
    const cargo = planAmbientLeg(
      at(0, 0),
      at(300, 0),
      buildWalkGraph(ambientRoads("street", roads)),
    );
    expect(
      metersBetween(
        sampleAmbientLeg(cargo, flying(0.5), 18).lngLat,
        at(150, 0),
      ),
    ).toBeLessThan(5);
  });

  it("turns the short way round", () => {
    expect(turnBetween(350, 10)).toBeCloseTo(20);
    expect(turnBetween(10, 350)).toBeCloseTo(-20);
    expect(turnBetween(90, 270)).toBeCloseTo(-180);
  });
});
