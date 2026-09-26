// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapFogMark } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import { FOG_PULSE_PERIOD_MS, fogMarksData, fogPulseLevel } from "./fog-marks";

const cell = {
  id: "8928308280fffff",
  center: { longitude: 30.5234, latitude: 50.4501 },
  boundary: [
    [30.522, 50.449],
    [30.525, 50.449],
    [30.526, 50.451],
    [30.523, 50.452],
  ] as const,
};

describe("fogPulseLevel", () => {
  it("breathes from a cell's own tint down to nothing and back, once a period", () => {
    expect(fogPulseLevel(0)).toBeCloseTo(0.5, 5);
    expect(fogPulseLevel(FOG_PULSE_PERIOD_MS / 4)).toBeCloseTo(1, 5);
    expect(fogPulseLevel(FOG_PULSE_PERIOD_MS / 2)).toBeCloseTo(0.5, 5);
    expect(fogPulseLevel((FOG_PULSE_PERIOD_MS * 3) / 4)).toBeCloseTo(0, 5);
    // A full period is the same phase as the start: it never drifts.
    expect(fogPulseLevel(FOG_PULSE_PERIOD_MS)).toBeCloseTo(fogPulseLevel(0), 5);
  });

  it("never leaves the 0..1 range a pulse value has to stay inside", () => {
    for (let ms = 0; ms < FOG_PULSE_PERIOD_MS * 3; ms += 137) {
      const level = fogPulseLevel(ms);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe("fogMarksData pulse property", () => {
  const marks: readonly MapFogMark[] = [
    { cell, state: "available" },
    { cell, state: "revealing", progress: 0.4 },
  ];

  it("only breathes the cell actually being revealed", () => {
    const data = fogMarksData(marks, 0.2) as {
      features: { properties: { state: string; pulse: number } }[];
    };
    expect(data.features[0]?.properties).toMatchObject({
      state: "available",
      pulse: 1,
    });
    expect(data.features[1]?.properties).toMatchObject({
      state: "revealing",
      pulse: 0.2,
    });
  });

  it("defaults to its own tint, fully shown, with no pulse given", () => {
    const data = fogMarksData(marks) as {
      features: { properties: { pulse: number } }[];
    };
    expect(data.features[1]?.properties.pulse).toBe(1);
  });
});
