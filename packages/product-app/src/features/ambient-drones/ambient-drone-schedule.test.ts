// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import {
  AMBIENT_CELL_METERS,
  AMBIENT_HOVER_MS,
  AMBIENT_LEG_MS,
  AMBIENT_MAX_DRONES,
  ambientReachMeters,
  cellCentre,
  cellOf,
  cellsAround,
  dronesAround,
  dronesOf,
  legAt,
  metersBetween,
  waypoint,
} from "./ambient-drone-schedule";

const KYIV: readonly [number, number] = [30.4505, 50.4745];

describe("ambient drone schedule", () => {
  it("cuts the world into square cells that hold the point they name", () => {
    const cell = cellOf(KYIV);
    expect(metersBetween(KYIV, cellCentre(cell))).toBeLessThan(
      (AMBIENT_CELL_METERS * Math.SQRT2) / 2 + 1,
    );
    const east = cellCentre({ ...cell, column: cell.column + 1 });
    expect(metersBetween(cellCentre(cell), east)).toBeCloseTo(
      AMBIENT_CELL_METERS,
      0,
    );
    // Rows are 600 m apart; each row sets its own longitude step.
    const north = cellCentre({ ...cell, row: cell.row + 1 });
    expect((north[1] - cellCentre(cell)[1]) * 111_195).toBeCloseTo(
      AMBIENT_CELL_METERS,
      3,
    );
  });

  it("lists the cells around a point nearest first, within reach only", () => {
    const cells = cellsAround(KYIV, 1_000);
    expect(cells[0]).toEqual(cellOf(KYIV));
    const distances = cells.map((cell) =>
      metersBetween(KYIV, cellCentre(cell)),
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(Math.max(...distances)).toBeLessThanOrEqual(1_000);
    // A 1 km disc over 600 m cells is about nine of them.
    expect(cells.length).toBeGreaterThanOrEqual(7);
    expect(cells.length).toBeLessThanOrEqual(13);
  });

  it("gives a cell the same drones every time, on any device", () => {
    const cell = cellOf(KYIV);
    expect(dronesOf(cell)).toEqual(dronesOf({ ...cell }));
    const counts = new Map<number, number>();
    for (let row = 0; row < 40; row++)
      for (let column = 0; column < 40; column++) {
        const count = dronesOf({ row, column }).length;
        counts.set(count, (counts.get(count) ?? 0) + 1);
      }
    // About a quarter empty, half with one, a quarter with two.
    expect(counts.get(0)! / 1600).toBeGreaterThan(0.18);
    expect(counts.get(0)! / 1600).toBeLessThan(0.32);
    expect(counts.get(2)! / 1600).toBeGreaterThan(0.18);
    expect(counts.get(2)! / 1600).toBeLessThan(0.32);
    expect([...counts.keys()].sort()).toEqual([0, 1, 2]);
  });

  it("keeps a drone's waypoints around its own hub, a step on each leg", () => {
    for (let row = 0; row < 30; row++) {
      for (const drone of dronesOf({ row, column: row * 3 })) {
        for (let leg = -5; leg < 20; leg++) {
          const point = waypoint(drone, leg);
          const distance = metersBetween(drone.hub, point);
          expect(distance).toBeGreaterThanOrEqual(drone.ringMeters * 0.69);
          expect(distance).toBeLessThanOrEqual(drone.ringMeters * 1.31);
          const step = metersBetween(point, waypoint(drone, leg + 1));
          expect(step).toBeGreaterThan(30);
          expect(step).toBeLessThan(drone.ringMeters * 2.7);
        }
        expect(waypoint(drone, 7)).toEqual(waypoint({ ...drone }, 7));
      }
    }
  });

  it("finds a drone's leg from the clock alone: a hover, then the flight", () => {
    const [drone] = dronesAround(KYIV, 1_200);
    expect(drone).toBeDefined();
    const start = AMBIENT_LEG_MS * 1_000_000 - drone!.offsetMs;
    expect(legAt(drone!, start)).toEqual({
      leg: 1_000_000,
      hover: 0,
      flight: 0,
    });
    expect(legAt(drone!, start + AMBIENT_HOVER_MS / 2)).toEqual({
      leg: 1_000_000,
      hover: 0.5,
      flight: 0,
    });
    const midFlight = legAt(
      drone!,
      start + AMBIENT_HOVER_MS + (AMBIENT_LEG_MS - AMBIENT_HOVER_MS) / 2,
    );
    expect(midFlight.hover).toBe(1);
    expect(midFlight.flight).toBeCloseTo(0.5);
    expect(legAt(drone!, start + AMBIENT_LEG_MS).leg).toBe(1_000_001);
  });

  it("draws only so many drones, from the nearest cells", () => {
    const drones = dronesAround(KYIV, 1_400);
    expect(drones.length).toBeLessThanOrEqual(AMBIENT_MAX_DRONES);
    expect(new Set(drones.map((drone) => drone.id)).size).toBe(drones.length);
  });

  it("reaches over what the view spans, further when pitched, never far", () => {
    const flat = ambientReachMeters(50.45, 17, 0, 1_000);
    expect(ambientReachMeters(50.45, 17, 60, 1_000)).toBeGreaterThan(flat);
    expect(ambientReachMeters(50.45, 16, 0, 1_000)).toBeGreaterThan(flat);
    expect(ambientReachMeters(50.45, 10, 80, 4_000)).toBe(1_400);
  });
});
