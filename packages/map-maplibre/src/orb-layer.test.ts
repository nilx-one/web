// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { MapOrb } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  ORB_FALL_MS,
  ORB_PULL_MS,
  ORBS_SOURCE_ID,
  orbFall,
  orbPull,
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

  it("tints a cell orb by its rarity, a find's orb by the glow", () => {
    const data = orbsData(
      [orb("a", 0), { ...orb("b", 0), rarity: "exclusive" }],
      1_000,
    ) as { features: { properties: { color: string } }[] };
    expect(data.features.map((feature) => feature.properties.color)).toEqual([
      "#7fe6ff",
      "#e8b84c",
    ]);
  });

  it("draws a picked-up orb in to its picker, shrinking, then not at all", () => {
    const pulled: MapOrb = {
      ...orb("a", 0),
      pulledTo: { longitude: 1, latitude: 1, at: 1_000 },
    };
    const at = (now: number) =>
      orbsData([pulled], now) as {
        features: {
          geometry: { coordinates: [number, number] };
          properties: { scale: number };
        }[];
      };
    expect(orbPull(pulled, 1_000)).toBe(0);
    const halfway = at(1_000 + ORB_PULL_MS / 2).features[0]!;
    expect(halfway.geometry.coordinates[0]).toBeGreaterThan(1);
    expect(halfway.geometry.coordinates[0]).toBeLessThan(30.52);
    expect(halfway.properties.scale).toBeLessThan(1);
    expect(at(1_000 + ORB_PULL_MS).features).toEqual([]);
    expect(orbsFalling([pulled], 1_000 + ORB_PULL_MS / 2)).toBe(true);
    expect(orbsFalling([pulled], 1_000 + ORB_PULL_MS)).toBe(false);
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
