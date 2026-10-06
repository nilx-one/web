// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { inside, joinAreas, type AreaPart } from "./landmark-areas";

type Ring = [number, number][];

/** A closed square from (x, y), `side` across, in plain degrees. */
const square = (x: number, y: number, side: number): Ring => [
  [x, y],
  [x + side, y],
  [x + side, y + side],
  [x, y + side],
  [x, y],
];

const none = { poiLabels: [], landuse: [], waterLabels: [], water: [] };

describe("joinAreas", () => {
  it("names a landuse polygon by the pois point that shares its id, every piece of it", () => {
    // One park cut by a tile edge at x = 1: two pieces, one id.
    const west: AreaPart = {
      id: 5,
      kind: "park",
      polygons: [[square(0, 0, 1.01)]],
    };
    const east: AreaPart = {
      id: 5,
      kind: "park",
      polygons: [[square(1, 0, 1)]],
    };
    const [park, ...rest] = joinAreas({
      ...none,
      poiLabels: [{ id: 5, name: "Park", point: [0.5, 0.5] }],
      landuse: [
        west,
        east,
        // The same piece read again, from the view.
        west,
        { id: 6, kind: "park", polygons: [[square(5, 5, 1)]] },
      ],
    });

    expect(rest).toEqual([]);
    expect(park).toMatchObject({
      id: "poi:5",
      layer: "landuse",
      kind: "park",
      name: "Park",
      label: { longitude: 0.5, latitude: 0.5 },
    });
    expect(park!.polygons).toHaveLength(2);
  });

  it("names a lake by the water label inside it, and the pieces that overlap it", () => {
    const lake = (x: number): AreaPart => ({
      id: undefined,
      kind: "water",
      kindDetail: "lake",
      polygons: [[square(x, 0, 1.01)]],
    });
    const [found, ...rest] = joinAreas({
      ...none,
      waterLabels: [
        {
          id: undefined,
          name: "Lake",
          point: [0.5, 0.5],
          kind: "water",
          kindDetail: "lake",
        },
        // A label whose kind no polygon around it shares names nothing.
        {
          id: undefined,
          name: "River",
          point: [0.5, 0.5],
          kind: "water",
          kindDetail: "river",
        },
      ],
      water: [lake(0), lake(1), lake(5)],
    });

    expect(rest).toEqual([]);
    expect(found).toMatchObject({
      layer: "water",
      kind: "water",
      kindDetail: "lake",
      name: "Lake",
    });
    // The piece across the tile edge comes with it; the separate one does not.
    expect(found!.polygons).toHaveLength(2);
  });

  it("names nothing without both a label and a polygon", () => {
    expect(
      joinAreas({
        ...none,
        poiLabels: [{ id: 9, name: "Nowhere", point: [0, 0] }],
        landuse: [{ id: 5, kind: "park", polygons: [[square(0, 0, 1)]] }],
        waterLabels: [
          { id: undefined, name: "Dry", point: [9, 9], kind: "water" },
        ],
        water: [
          { id: undefined, kind: "water", polygons: [[square(0, 0, 1)]] },
        ],
      }),
    ).toEqual([]);
  });

  it("gives the same areas for the same sources in any order", () => {
    const sources = {
      ...none,
      poiLabels: [
        { id: 2, name: "B", point: [2.5, 0.5] as [number, number] },
        { id: 1, name: "A", point: [0.5, 0.5] as [number, number] },
      ],
      landuse: [
        { id: 1, kind: "park", polygons: [[square(0, 0, 1)]] },
        { id: 2, kind: "nature_reserve", polygons: [[square(2, 0, 1)]] },
      ],
    };
    const once = joinAreas(sources);
    expect(
      joinAreas({
        ...sources,
        poiLabels: [...sources.poiLabels].reverse(),
        landuse: [...sources.landuse].reverse(),
      }),
    ).toEqual(once);
    expect(once.map((area) => area.id)).toEqual(["poi:1", "poi:2"]);
  });
});

describe("inside", () => {
  it("is inside the outer ring and in no hole", () => {
    const polygon = [square(0, 0, 4), square(1, 1, 2)];
    expect(inside([0.5, 0.5], polygon)).toBe(true);
    expect(inside([2, 2], polygon)).toBe(false);
    expect(inside([5, 5], polygon)).toBe(false);
  });
});
