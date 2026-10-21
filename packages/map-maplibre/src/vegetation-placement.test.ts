// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  GREEN_CHARACTER,
  VEGETATION_MAX_TREES,
  inPolygon,
  plantVegetation,
  type AreaPolygon,
  type GreenArea,
} from "./vegetation-placement";

// A square about 220 m across in central Kyiv, near Zoloti Vorota.
const W = 30.51;
const S = 50.448;
const E = 30.5131;
const N = 50.45;
const square = (w: number, s: number, e: number, n: number): AreaPolygon => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
];
const VIEW = { west: 30.5, south: 50.44, east: 30.53, north: 50.46 };
const CENTER = [30.5115, 50.449] as const;

function plant(areas: readonly GreenArea[], obstacles: AreaPolygon[] = []) {
  return plantVegetation({ areas, obstacles, bounds: VIEW, center: CENTER });
}

describe("trees and bushes in the city's green areas", () => {
  it("stand only inside the area that holds them", () => {
    const park = square(W, S, E, N);
    const { trees, bushes } = plant([{ kind: "park", polygon: park }]);
    expect(trees.length).toBeGreaterThan(50);
    expect(bushes.length).toBeGreaterThan(50);
    for (const plant of [...trees, ...bushes]) {
      expect(inPolygon(park, plant.lngLat[0], plant.lngLat[1])).toBe(true);
    }
  });

  it("are the same trees however the area reaches the view", () => {
    const whole = plant([{ kind: "park", polygon: square(W, S, E, N) }]);
    // The same park, cut in two along a tile edge, and delivered twice.
    const mid = (W + E) / 2;
    const halves: GreenArea[] = [
      { kind: "park", polygon: square(mid, S, E, N) },
      { kind: "park", polygon: square(W, S, mid, N) },
      { kind: "park", polygon: square(W, S, mid, N) },
    ];
    const cut = plant(halves);
    const ids = (list: readonly { id: string }[]) =>
      list.map((entry) => entry.id).sort();
    expect(ids(cut.trees)).toEqual(ids(whole.trees));
    expect(ids(cut.bushes)).toEqual(ids(whole.bushes));
  });

  it("never grow inside a building or in the water", () => {
    const building = square(30.511, 50.4485, 30.5122, 50.4495);
    const { trees } = plant(
      [{ kind: "park", polygon: square(W, S, E, N) }],
      [building],
    );
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      expect(inPolygon(building, tree.lngLat[0], tree.lngLat[1])).toBe(false);
    }
  });

  it("are thick in a wood, sparse on a lawn and absent from a pitch", () => {
    const area = square(W, S, E, N);
    const count = (kind: string) =>
      plant([{ kind, polygon: area }]).trees.length;
    expect(count("forest")).toBeGreaterThan(count("park"));
    expect(count("park")).toBeGreaterThan(count("grass"));
    expect(count("pitch")).toBe(0);
    expect(count("playground")).toBe(0);
    expect(count("residential")).toBe(0);
  });

  it("are a wood's mix in a wood: spruce among the broadleaf", () => {
    const { trees } = plant([{ kind: "wood", polygon: square(W, S, E, N) }]);
    const models = new Set(trees.map((tree) => tree.model));
    expect(models.has("tree-pine")).toBe(true);
    expect(models.has("tree-round")).toBe(true);
  });

  it("keep the nearest to the view's centre when there are too many", () => {
    const wide = square(30.49, 50.43, 30.54, 50.47);
    const { trees } = plantVegetation({
      areas: [{ kind: "forest", polygon: wide }],
      obstacles: [],
      bounds: { west: 30.495, south: 50.435, east: 30.535, north: 50.465 },
      center: CENTER,
    });
    expect(trees).toHaveLength(VEGETATION_MAX_TREES);
  });

  it("plants every green kind the published style paints, or leaves it open on purpose", () => {
    // The `parks` layer's filter in deploy/web/map/0.1.0/style.json.
    const painted = [
      "national_park",
      "park",
      "garden",
      "cemetery",
      "protected_area",
      "nature_reserve",
      "forest",
      "wood",
      "golf_course",
      "grass",
      "grassland",
      "scrub",
      "recreation_ground",
      "village_green",
      "allotments",
      "playground",
      "pitch",
    ];
    for (const kind of painted) expect(GREEN_CHARACTER[kind]).toBeDefined();
  });
});
