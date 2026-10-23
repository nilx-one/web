// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { MapOrb } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  ORB_BURST_MS,
  ORB_COLLECT_MS,
  ORB_FADE_MS,
  ORB_FALL_MS,
  ORB_LIFT_MS,
  ORB_PULL_MS,
  ORBS_SOURCE_ID,
  orbFall,
  orbPull,
  orbsData,
  orbsFalling,
  orbsGlowing,
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
      // Still, so a breath does not move the glow under the check.
      { reducedMotion: true },
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

  it("lights a cell orb's core and glow in its rarity's colour", () => {
    const data = orbsData(
      [orb("a", 0), { ...orb("b", 0), rarity: "exclusive" }],
      1_000,
    ) as { features: { properties: { core: string; glow: number } }[] };
    const [find, exclusive] = data.features.map((f) => f.properties);
    expect(find?.core).toBe("#f2fdff");
    // Exclusive gold, lit towards white.
    expect(exclusive?.core).toBe("#f5dfae");
    expect(exclusive!.glow).toBeGreaterThan(find!.glow);
  });

  it("shines rarer orbs wider, with an aura from Rare up", () => {
    const shine = (rarity: NonNullable<MapOrb["rarity"]>) =>
      (
        orbsData([{ ...orb("a", 0), rarity }], 1_000, {
          reducedMotion: true,
        }) as { features: { properties: { spread: number; aura: number } }[] }
      ).features[0]!.properties;
    const ladder = (
      ["common", "uncommon", "rare", "special", "exclusive"] as const
    ).map(shine);
    for (let step = 1; step < ladder.length; step += 1) {
      expect(ladder[step]!.spread).toBeGreaterThan(ladder[step - 1]!.spread);
    }
    expect(ladder.map((item) => item.aura > 0)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("breathes a lying orb's glow, unless motion is reduced", () => {
    const lying = [{ ...orb("a", 0), rarity: "rare" as const }];
    const spread = (now: number, reducedMotion = false) =>
      (
        orbsData(lying, now, { reducedMotion }) as {
          features: { properties: { spread: number } }[];
        }
      ).features[0]!.properties.spread;
    const samples = Array.from({ length: 20 }, (_, step) =>
      spread(10_000 + step * 100),
    );
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.1);
    expect(spread(10_000, true)).toBe(spread(10_500, true));
    expect(orbsGlowing(lying)).toBe(true);
    expect(orbsGlowing(lying, { reducedMotion: true })).toBe(false);
  });

  it("collects a picked-up orb: a hop, an arc with a tail, then a flash", () => {
    const pulled: MapOrb = {
      ...orb("a", 0),
      rarity: "special",
      pulledTo: { longitude: 30.53, latitude: 50.45, at: 1_000 },
    };
    type Drawn = {
      features: {
        geometry: { coordinates: [number, number] };
        properties: { kind: string; scale: number; ring?: number };
      }[];
    };
    const at = (now: number) => orbsData([pulled], now) as Drawn;

    // The hop: it swells where it lay.
    const hop = at(1_000 + ORB_LIFT_MS).features;
    expect(hop).toHaveLength(1);
    expect(hop[0]!.geometry.coordinates).toEqual([30.52, 50.45]);
    expect(hop[0]!.properties.scale).toBeGreaterThan(1.4);

    // The flight: off the straight line, with fading beads behind it.
    const flying = at(1_000 + ORB_LIFT_MS + ORB_PULL_MS * 0.6).features;
    expect(flying.length).toBeGreaterThan(1);
    const [longitude, latitude] = flying[0]!.geometry.coordinates;
    expect(longitude).toBeGreaterThan(30.52);
    expect(longitude).toBeLessThan(30.53);
    expect(latitude).not.toBeCloseTo(50.45, 6);
    expect(orbPull(pulled, 1_000 + ORB_LIFT_MS + ORB_PULL_MS)).toBe(1);

    // The flash: a ring opening where the picker is.
    const flash = at(1_000 + ORB_LIFT_MS + ORB_PULL_MS + 1).features;
    expect(flash.map((feature) => feature.properties.kind)).toEqual(["burst"]);
    expect(flash[0]!.geometry.coordinates).toEqual([30.53, 50.45]);
    const later = at(1_000 + ORB_LIFT_MS + ORB_PULL_MS + ORB_BURST_MS / 2)
      .features[0]!;
    expect(later.properties.ring).toBeGreaterThan(flash[0]!.properties.ring!);

    expect(at(1_000 + ORB_COLLECT_MS).features).toEqual([]);
    expect(orbsFalling([pulled], 1_000 + ORB_COLLECT_MS - 1)).toBe(true);
    expect(orbsFalling([pulled], 1_000 + ORB_COLLECT_MS)).toBe(false);
    expect(orbsGlowing([pulled])).toBe(false);
  });

  it("only fades a picked-up orb in place when motion is reduced", () => {
    const pulled: MapOrb = {
      ...orb("a", 0),
      pulledTo: { longitude: 1, latitude: 1, at: 1_000 },
    };
    const options = { reducedMotion: true };
    const half = orbsData([pulled], 1_000 + ORB_FADE_MS / 2, options) as {
      features: {
        geometry: { coordinates: [number, number] };
        properties: { opacity: number };
      }[];
    };
    expect(half.features).toHaveLength(1);
    expect(half.features[0]!.geometry.coordinates).toEqual([30.52, 50.45]);
    expect(half.features[0]!.properties.opacity).toBeCloseTo(0.5);
    expect(orbsFalling([pulled], 1_000 + ORB_FADE_MS, options)).toBe(false);
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
