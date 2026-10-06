// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { joinAreas, type AreaPart } from "./landmark-areas";
import { tileBounds } from "./road-tiles";

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

  it("joins equivalent lake label and polygon schema spellings", () => {
    const waterLake: AreaPart = {
      id: undefined,
      kind: "water",
      kindDetail: "lake",
      polygons: [[square(0, 0, 1)]],
    };

    for (const label of [
      { id: undefined, name: "Lake", point: [0.5, 0.5] as [number, number], kind: "lake" },
      { id: undefined, name: "Lake", point: [0.5, 0.5] as [number, number], kind: "water" },
    ]) {
      const [found] = joinAreas({
        ...none,
        waterLabels: [label],
        water: [waterLake],
      });
      expect(found).toMatchObject({
        layer: "water",
        kind: "water",
        kindDetail: "lake",
        name: "Lake",
      });
    }
  });

  it("keeps one water area id across tiny label decode differences", () => {
    const water: AreaPart[] = [
      {
        id: undefined,
        kind: "water",
        kindDetail: "lake",
        polygons: [[square(30, 50, 1)]],
      },
    ];
    const idAt = (point: [number, number]) =>
      joinAreas({
        ...none,
        waterLabels: [
          {
            id: undefined,
            name: "Lake",
            point,
            kind: "water",
            kindDetail: "lake",
          },
        ],
        water,
      })[0]!.id;

    expect(idAt([30.512341, 50.512341])).toBe(
      idAt([30.512342, 50.512342]),
    );
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

  it("counts ground once where tiles' buffers and zooms overlap", () => {
    // A park across the edge of two z15 tiles, each piece reaching into the
    // other tile's buffer, and the same park from a z14 view tile.
    const left = { z: 15, x: 19_168, y: 11_093 };
    const right = { ...left, x: left.x + 1 };
    const l = tileBounds(left);
    const r = tileBounds(right);
    const pad = (l.east - l.west) / 64;
    const rect = (west: number, east: number): Ring => [
      [west, l.south + pad],
      [east, l.south + pad],
      [east, l.north - pad],
      [west, l.north - pad],
      [west, l.south + pad],
    ];
    const westPark = (l.west + l.east) / 2;
    const eastPark = (r.west + r.east) / 2;
    const part = (polygon: Ring, tile: AreaPart["tile"]): AreaPart => ({
      id: 7,
      kind: "park",
      polygons: [[polygon]],
      ...(tile === undefined ? {} : { tile }),
    });
    const [park] = joinAreas({
      ...none,
      poiLabels: [
        { id: 7, name: "Park", point: [l.east, (l.south + l.north) / 2] },
      ],
      landuse: [
        part(rect(westPark, l.east + pad), left),
        part(rect(r.west - pad, eastPark), right),
        part(rect(westPark, eastPark), { z: 14, x: left.x / 2, y: 5_546 }),
      ],
    });

    const edges = park!.polygons.map((rings) => {
      const xs = rings[0]!.map(([x]) => x);
      return [Math.min(...xs), Math.max(...xs)];
    });
    expect(edges).toHaveLength(2);
    expect(edges[0]![0]).toBeCloseTo(westPark, 12);
    expect(edges[0]![1]).toBeCloseTo(l.east, 12);
    expect(edges[1]![0]).toBeCloseTo(r.west, 12);
    expect(edges[1]![1]).toBeCloseTo(eastPark, 12);
  });
});
