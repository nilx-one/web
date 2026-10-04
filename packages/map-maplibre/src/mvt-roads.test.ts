// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { decodeTileRoads } from "./mvt-roads";
import { tileBounds } from "./road-tiles";

// A minimal Mapbox Vector Tile writer: just enough protobuf to build fixtures.
function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return out;
}
const key = (field: number, wire: number) => varint(field * 8 + wire);
const delimited = (field: number, bytes: number[]) => [
  ...key(field, 2),
  ...varint(bytes.length),
  ...bytes,
];
const text = (field: number, value: string) =>
  delimited(field, [...new TextEncoder().encode(value)]);
const zz = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);

type Value = string | boolean;

function encodeValue(value: Value): number[] {
  return typeof value === "string"
    ? text(1, value)
    : [...key(7, 0), ...varint(value ? 1 : 0)];
}

/** Lines as absolute tile coordinates, one MoveTo and one LineTo run each. */
function geometry(lines: readonly (readonly [number, number])[][]): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const line of lines) {
    const [first, ...rest] = line;
    out.push(1 | (1 << 3), zz(first![0] - x), zz(first![1] - y));
    [x, y] = first!;
    out.push(2 | (rest.length << 3));
    for (const [px, py] of rest) {
      out.push(zz(px - x), zz(py - y));
      [x, y] = [px, py];
    }
  }
  return out;
}

interface FixtureFeature {
  readonly type: number;
  readonly properties: Record<string, Value>;
  readonly lines: readonly (readonly [number, number])[][];
}

function encodeTile(
  layers: Record<string, readonly FixtureFeature[]>,
): Uint8Array {
  const tile: number[] = [];
  for (const [name, features] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: Value[] = [];
    const index = <T>(list: T[], item: T) => {
      const at = list.indexOf(item);
      if (at >= 0) return at;
      list.push(item);
      return list.length - 1;
    };
    const encoded = features.map((feature) => {
      const tags = Object.entries(feature.properties).flatMap(([k, v]) => [
        index(keys, k),
        index(values, v),
      ]);
      const geom = geometry(feature.lines);
      return [
        ...delimited(2, tags.flatMap(varint)),
        ...key(3, 0),
        ...varint(feature.type),
        ...delimited(4, geom.flatMap(varint)),
      ];
    });
    const layer = [
      ...key(15, 0),
      ...varint(2),
      ...text(1, name),
      ...encoded.flatMap((f) => delimited(2, f)),
      ...keys.flatMap((k) => text(3, k)),
      ...values.flatMap((v) => delimited(4, encodeValue(v))),
      ...key(5, 0),
      ...varint(4096),
    ];
    tile.push(...delimited(3, layer));
  }
  return new Uint8Array(tile);
}

const TILE = { z: 14, x: 9581, y: 5528 };

describe("decodeTileRoads", () => {
  const bytes = encodeTile({
    pois: [{ type: 1, properties: { kind: "monument" }, lines: [[[10, 10]]] }],
    roads: [
      {
        type: 2,
        properties: { kind: "path", kind_detail: "footway" },
        lines: [
          [
            [0, 0],
            [4096, 0],
          ],
        ],
      },
      {
        type: 2,
        properties: { kind: "minor_road", is_bridge: true },
        lines: [
          [
            [0, 2048],
            [2048, 2048],
          ],
          [
            [100, 100],
            [200, 300],
            [300, 300],
          ],
        ],
      },
      // No kind: nothing to say how it is walked.
      {
        type: 2,
        properties: { kind_detail: "footway" },
        lines: [
          [
            [0, 0],
            [10, 10],
          ],
        ],
      },
      // A polygon is not a line.
      {
        type: 3,
        properties: { kind: "path" },
        lines: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
        ],
      },
    ],
  });

  it("reads the roads layer's lines with their attributes verbatim", () => {
    const roads = decodeTileRoads(bytes, TILE, "roads");
    expect(
      roads.map(({ kind, kindDetail, isBridge, lines }) => ({
        kind,
        kindDetail,
        isBridge,
        lines: lines.length,
        points: lines.map((line) => line.length),
      })),
    ).toEqual([
      {
        kind: "path",
        kindDetail: "footway",
        isBridge: undefined,
        lines: 1,
        points: [2],
      },
      {
        kind: "minor_road",
        kindDetail: undefined,
        isBridge: true,
        lines: 2,
        points: [2, 3],
      },
    ]);
  });

  it("places tile coordinates on the tile's own ground", () => {
    const [footway] = decodeTileRoads(bytes, TILE, "roads");
    const box = tileBounds(TILE);
    const [start, end] = footway!.lines[0]!;
    expect(start![0]).toBeCloseTo(box.west, 9);
    expect(start![1]).toBeCloseTo(box.north, 9);
    expect(end![0]).toBeCloseTo(box.east, 9);
    expect(end![1]).toBeCloseTo(box.north, 9);
  });

  it("answers nothing for a layer the tile does not carry", () => {
    expect(decodeTileRoads(bytes, TILE, "transportation")).toEqual([]);
    expect(decodeTileRoads(new Uint8Array(), TILE, "roads")).toEqual([]);
  });
});
