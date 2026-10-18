// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRoad } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";
import {
  BRIDGE_DECK_LAYER_ID,
  BRIDGE_PALETTES,
  BRIDGE_PIER_LAYER_ID,
  BRIDGE_RAMP_GRADE,
  BRIDGE_STRUCTURE_MIN_ZOOM,
  bridgeStructureLayers,
  bridgeStructures,
  type BridgeFeature,
} from "./bridge-structures";

const ORIGIN: readonly [number, number] = [30.58, 50.43];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): [number, number] => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];
/** Metres east of the origin, for a feature's first corner. */
const eastOf = (feature: BridgeFeature) =>
  (feature.geometry.coordinates[0]![0]![0] - ORIGIN[0]) / M_LON;

// A 600 m road bridge over a river, between two roads on the banks.
const bridge: MapRoad = {
  kind: "major_road",
  kindDetail: "primary",
  isBridge: true,
  lines: [[at(0, 0), at(300, 0), at(600, 0)]],
};
const banks: MapRoad[] = [
  {
    kind: "major_road",
    kindDetail: "primary",
    lines: [[at(-200, 0), at(0, 0)]],
  },
  {
    kind: "major_road",
    kindDetail: "primary",
    lines: [[at(600, 0), at(800, 0)]],
  },
];

const decks = (features: readonly BridgeFeature[]) =>
  features.filter((feature) => feature.properties.part === "deck");
const piers = (features: readonly BridgeFeature[]) =>
  features.filter((feature) => feature.properties.part === "pier");

describe("bridge structures", () => {
  it("build nothing where no bridge carries anything", () => {
    expect(bridgeStructures(banks).features).toEqual([]);
    expect(
      bridgeStructures([
        { kind: "other", isBridge: true, lines: [[at(0, 0), at(100, 0)]] },
      ]).features,
    ).toEqual([]);
  });

  it("raise a deck from where it meets the ground, up to its kind's height", () => {
    const { features } = bridgeStructures([bridge, ...banks]);
    const deck = decks(features);
    expect(deck.length).toBeGreaterThan(40);
    const tops = deck.map((piece) => piece.properties.top);
    expect(Math.max(...tops)).toBeCloseTo(14);
    // Climbing at the ramp's grade from either bank.
    for (const piece of deck) {
      const x = eastOf(piece);
      const fromGround = Math.min(x, 600 - x);
      expect(piece.properties.top).toBeLessThanOrEqual(
        fromGround * BRIDGE_RAMP_GRADE + 1.5,
      );
      expect(piece.properties.bottom).toBeCloseTo(
        Math.max(0, piece.properties.top - 2),
      );
    }
    // The first metres lie on the ground and are left to the flat style.
    expect(Math.min(...deck.map(eastOf))).toBeGreaterThan(5);
  });

  it("stand piers only under deck high enough to need them", () => {
    const { features } = bridgeStructures([bridge, ...banks]);
    const under = piers(features);
    // 600 m at one pier every 60 m: about ten, the low ends left out.
    expect(under.length).toBeGreaterThanOrEqual(6);
    expect(under.length).toBeLessThanOrEqual(10);
    for (const pier of under) {
      expect(pier.properties.bottom).toBe(0);
      expect(pier.properties.top).toBeGreaterThan(1);
      expect(pier.properties.top).toBeLessThanOrEqual(12);
    }
  });

  it("keep full height where the bridge's ends are not loaded", () => {
    const { features } = bridgeStructures([bridge]);
    for (const piece of decks(features))
      expect(piece.properties.top).toBeCloseTo(14);
  });

  it("build the same stretch once, however many tiles repeat it", () => {
    const once = bridgeStructures([bridge, ...banks]).features.length;
    expect(bridgeStructures([bridge, bridge, ...banks]).features.length).toBe(
      once,
    );
  });

  it("make a footbridge narrower and lower than a road bridge", () => {
    const foot = bridgeStructures([
      { ...bridge, kind: "path", kindDetail: "footway" },
    ]);
    const road = bridgeStructures([bridge]);
    const width = (feature: BridgeFeature) => {
      // The ring's first and third corners lie on opposite sides of a deck
      // that runs east, so their latitudes are a width apart.
      const ring = feature.geometry.coordinates[0]!;
      return Math.abs((ring[2]![1] - ring[0]![1]) / M_LAT);
    };
    expect(width(decks(foot.features)[0]!)).toBeLessThan(
      width(decks(road.features)[0]!),
    );
    expect(decks(foot.features)[0]!.properties.top).toBeLessThan(
      decks(road.features)[0]!.properties.top,
    );
  });

  it("are drawn as lit extrusions from close zoom, piers beneath decks", () => {
    const layers = bridgeStructureLayers(BRIDGE_PALETTES.light);
    expect(layers.map((layer) => layer.id)).toEqual([
      BRIDGE_PIER_LAYER_ID,
      BRIDGE_DECK_LAYER_ID,
    ]);
    for (const layer of layers) {
      expect(layer.type).toBe("fill-extrusion");
      expect(layer.minzoom).toBe(BRIDGE_STRUCTURE_MIN_ZOOM);
      const paint = layer.paint as Record<string, unknown>;
      expect(paint["fill-extrusion-base"]).toEqual(["get", "bottom"]);
      expect(paint["fill-extrusion-height"]).toEqual(["get", "top"]);
    }
    expect(
      (layers[1]!.paint as Record<string, unknown>)["fill-extrusion-color"],
    ).toBe(BRIDGE_PALETTES.light.deck);
  });
});
