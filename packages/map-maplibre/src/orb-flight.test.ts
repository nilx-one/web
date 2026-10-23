// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  ORB_BURST_MS,
  ORB_COLLECT_MS,
  ORB_HOP_PX,
  ORB_LIFT_MS,
  ORB_PULL_MS,
  orbFlightFrame,
  orbPull,
} from "./orb-flight";

const from = { x: 100, y: 300 };
const chest = { x: 140, y: 260 };

describe("orbPull", () => {
  it("draws back a hair, then speeds up to arrive", () => {
    expect(orbPull(0)).toBe(0);
    expect(orbPull(0.2)).toBeLessThan(0);
    expect(orbPull(0.9) - orbPull(0.8)).toBeGreaterThan(
      orbPull(0.6) - orbPull(0.5),
    );
    expect(orbPull(1)).toBe(1);
  });
});

describe("orbFlightFrame", () => {
  it("hops the orb up off the ground, swelling", () => {
    const hop = orbFlightFrame(ORB_LIFT_MS - 1, from, chest, 1)!;
    expect(hop.bead!.x).toBe(from.x);
    expect(hop.bead!.y).toBeLessThan(from.y - ORB_HOP_PX * 0.9);
    expect(hop.bead!.scale).toBeGreaterThan(1.4);
    expect(hop.ring).toBeUndefined();
  });

  it("flies a high arc above both ends, with a fading tail", () => {
    const mid = orbFlightFrame(
      ORB_LIFT_MS + ORB_PULL_MS * 0.7,
      from,
      chest,
      1,
    )!;
    // Above both ends: it rises before it falls into the chest.
    expect(mid.bead!.y).toBeLessThan(chest.y - 5);
    const top = orbFlightFrame(
      ORB_LIFT_MS + ORB_PULL_MS * 0.9,
      from,
      chest,
      1,
    )!;
    expect(top.bead!.y).toBeLessThan(chest.y - 20);
    expect(mid.trail).toHaveLength(3);
    const opacities = mid.trail.map((bead) => bead.opacity);
    expect([...opacities].sort((a, b) => b - a)).toEqual(opacities);
    const other = orbFlightFrame(
      ORB_LIFT_MS + ORB_PULL_MS * 0.7,
      from,
      chest,
      -1,
    )!;
    expect(other.bead!.x).not.toBeCloseTo(mid.bead!.x, 0);
  });

  it("arrives at the chest and flashes a ring there, then is gone", () => {
    const end = orbFlightFrame(ORB_LIFT_MS + ORB_PULL_MS - 1, from, chest, 1)!;
    expect(Math.abs(end.bead!.x - chest.x)).toBeLessThan(2);
    expect(Math.abs(end.bead!.y - chest.y)).toBeLessThan(2);
    const flash = orbFlightFrame(ORB_LIFT_MS + ORB_PULL_MS, from, chest, 1)!;
    expect(flash.bead).toBeUndefined();
    expect(flash.ring).toMatchObject({ x: chest.x, y: chest.y });
    const later = orbFlightFrame(
      ORB_LIFT_MS + ORB_PULL_MS + ORB_BURST_MS / 2,
      from,
      chest,
      1,
    )!;
    expect(later.ring!.scale).toBeGreaterThan(flash.ring!.scale);
    expect(later.ring!.opacity).toBeLessThan(flash.ring!.opacity);
    expect(orbFlightFrame(ORB_COLLECT_MS, from, chest, 1)).toBeUndefined();
  });
});
