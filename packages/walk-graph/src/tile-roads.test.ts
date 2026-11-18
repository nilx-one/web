// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { buildWalkGraph, decodeTileRoads } from "./index";

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

interface FixtureFeature {
  readonly type: number;
  readonly properties: Record<string, Value>;
  readonly lines: readonly (readonly [number, number])[][];
}

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

function layer(name: string, features: readonly FixtureFeature[]): number[] {
  const keys: string[] = [];
  const values: Value[] = [];
  const index = <T>(list: T[], item: T) => {
    const at = list.indexOf(item);
    if (at >= 0) return at;
    list.push(item);
    return list.length - 1;
  };
  const encoded = features.map((feature) => [
    ...delimited(
      2,
      Object.entries(feature.properties)
        .flatMap(([k, v]) => [index(keys, k), index(values, v)])
        .flatMap(varint),
    ),
    ...key(3, 0),
    ...varint(feature.type),
    ...delimited(4, geometry(feature.lines).flatMap(varint)),
  ]);
  return delimited(3, [
    ...key(15, 0),
    ...varint(2),
    ...text(1, name),
    ...encoded.flatMap((f) => delimited(2, f)),
    ...keys.flatMap((k) => text(3, k)),
    ...values.flatMap((v) =>
      delimited(
        4,
        typeof v === "string"
          ? text(1, v)
          : [...key(7, 0), ...varint(v ? 1 : 0)],
      ),
    ),
    ...key(5, 0),
    ...varint(4096),
  ]);
}

const TILE = { z: 14, x: 9581, y: 5528 };
const n = 2 ** TILE.z;
const west = (TILE.x / n) * 360 - 180;
const east = ((TILE.x + 1) / n) * 360 - 180;
const north =
  (Math.atan(Math.sinh(Math.PI * (1 - (2 * TILE.y) / n))) * 180) / Math.PI;

const roads = layer("roads", [
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
]);

describe("decodeTileRoads", () => {
  it("reads the roads layer's lines with their attributes verbatim", () => {
    const bytes = new Uint8Array([
      ...layer("pois", [
        { type: 1, properties: { kind: "monument" }, lines: [[[10, 10]]] },
      ]),
      ...roads,
    ]);
    expect(
      decodeTileRoads(bytes, TILE).map(
        ({ kind, kindDetail, isBridge, lines }) => ({
          kind,
          kindDetail,
          isBridge,
          points: lines.map((line) => line.length),
        }),
      ),
    ).toEqual([
      {
        kind: "path",
        kindDetail: "footway",
        isBridge: undefined,
        points: [2],
      },
      {
        kind: "minor_road",
        kindDetail: undefined,
        isBridge: true,
        points: [2, 3],
      },
    ]);
  });

  it("places tile coordinates on the tile's own ground", () => {
    const [footway] = decodeTileRoads(new Uint8Array(roads), TILE);
    const [start, end] = footway!.lines[0]!;
    expect(start![0]).toBeCloseTo(west, 9);
    expect(start![1]).toBeCloseTo(north, 9);
    expect(end![0]).toBeCloseTo(east, 9);
    expect(end![1]).toBeCloseTo(north, 9);
  });

  it("answers nothing for a tile without roads", () => {
    expect(decodeTileRoads(new Uint8Array(), TILE)).toEqual([]);
  });

  it("refuses a tile it cannot read instead of answering part of it", () => {
    const bytes = new Uint8Array(roads);
    expect(() => decodeTileRoads(bytes.slice(0, -1), TILE)).toThrow(
      "malformed",
    );
    expect(() =>
      decodeTileRoads(new Uint8Array([0x1f, 0x8b, 8, 0]), TILE),
    ).toThrow("compressed");
    expect(() => decodeTileRoads(bytes, { z: 14, x: n, y: 0 })).toThrow(
      "invalid_tile",
    );
  });

  it("gives roads the walking graph builds on", () => {
    const graph = buildWalkGraph(decodeTileRoads(new Uint8Array(roads), TILE));
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
