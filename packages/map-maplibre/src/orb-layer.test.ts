// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { MapOrb } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  ORB_FALL_MS,
  ORBS_SOURCE_ID,
  orbFall,
  orbsData,
  orbsFalling,
  orbsLayers,
} from "./orb-layer";

const orb = (id: string, landsAt: number, kind: MapOrb["kind"] = "orb") =>
  ({ id, longitude: 30.52, latitude: 50.45, kind, landsAt }) as const;

describe("orbFall", () => {
  it("is nothing before the fall, overshoots on landing and lies still after", () => {
    const landsAt = 10_000;
    expect(orbFall({ landsAt }, landsAt - ORB_FALL_MS - 1)).toBe(0);
    const samples = Array.from({ length: 40 }, (_, step) =>
      orbFall({ landsAt }, landsAt - ORB_FALL_MS + (step * ORB_FALL_MS) / 40),
    );
    expect(Math.max(...samples)).toBeGreaterThan(1);
    expect(Math.max(...samples)).toBeLessThan(1.25);
    expect(orbFall({ landsAt }, landsAt)).toBe(1);
    expect(orbFall({ landsAt }, landsAt + 60_000)).toBe(1);
  });
});

describe("orbsData", () => {
  it("draws only what has started to fall", () => {
    const now = 50_000;
    const data = orbsData(
      [orb("a", now), orb("b", now + ORB_FALL_MS * 3), orb("g", now, "goal")],
      now,
    ) as { features: { properties: Record<string, unknown> }[] };
    expect(data.features.map((feature) => feature.properties.kind)).toEqual([
      "orb",
      "goal",
    ]);
    expect(data.features[0]?.properties).toMatchObject({
      scale: 1,
      spread: 1,
      opacity: 1,
    });
  });

  it("keeps the frames going only while an orb is still to land", () => {
    expect(orbsFalling([orb("a", 2_000)], 1_000)).toBe(true);
    expect(orbsFalling([orb("a", 2_000)], 2_000)).toBe(false);
  });
});

describe("orbsLayers", () => {
  it("is a valid style for the orbs source", () => {
    const errors = validateStyleMin({
      version: 8,
      sources: {
        [ORBS_SOURCE_ID]: {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        },
      },
      layers: orbsLayers() as never,
    });
    expect(errors).toEqual([]);
  });
});
