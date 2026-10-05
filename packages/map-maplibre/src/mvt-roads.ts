// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRoad } from "@nilx-one/map-contract";

/**
 * Reads the line features of one layer of a Mapbox Vector Tile into
 * `MapRoad`s: `kind`, `kind_detail` and `is_bridge` verbatim, lines in
 * `[longitude, latitude]`. Only what a walking graph needs is decoded, with no
 * dependency beyond the platform, the way `deploy/web/landmark-kinds.mjs`
 * reads `pois`.
 */
export function decodeTileRoads(
  bytes: Uint8Array,
  tile: { readonly z: number; readonly x: number; readonly y: number },
  layerName: string,
): MapRoad[] {
  const reader = protobuf(bytes);
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (field !== 3) {
      reader.skip(wire);
      continue;
    }
    const bytesOfLayer = reader.bytes();
    // The name is read first; any other layer is skipped whole, undecoded.
    if (nameOfLayer(bytesOfLayer) !== layerName) continue;
    const layer = decodeLayer(bytesOfLayer);
    const roads: MapRoad[] = [];
    for (const feature of layer.features) {
      if (feature.type !== LINESTRING) continue;
      const kind = feature.properties["kind"];
      if (typeof kind !== "string") continue;
      const lines = linesOf(feature.geometry)
        .filter((line) => line.length >= 2)
        .map((line) =>
          line.map(([px, py]) =>
            toLonLat(tile, px / layer.extent, py / layer.extent),
          ),
        );
      if (lines.length === 0) continue;
      const detail = feature.properties["kind_detail"];
      roads.push({
        kind,
        ...(typeof detail === "string" ? { kindDetail: detail } : {}),
        ...(feature.properties["is_bridge"] === true ? { isBridge: true } : {}),
        lines,
      });
    }
    return roads;
  }
  return [];
}

const LINESTRING = 2;

type Value = string | number | boolean;

interface Layer {
  name: string | undefined;
  extent: number;
  features: {
    type: number;
    geometry: number[];
    properties: Record<string, Value>;
  }[];
}

/** A layer's name, read without decoding its features, keys or values. */
function nameOfLayer(bytes: Uint8Array): string | undefined {
  const reader = protobuf(bytes);
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (field === 1) return text.decode(reader.bytes());
    reader.skip(wire);
  }
  return undefined;
}

function decodeLayer(bytes: Uint8Array): Layer {
  const reader = protobuf(bytes);
  const keys: string[] = [];
  const values: (Value | undefined)[] = [];
  const raw: Uint8Array[] = [];
  let name: string | undefined;
  let extent = 4096;
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (field === 1) name = text.decode(reader.bytes());
    else if (field === 2) raw.push(reader.bytes());
    else if (field === 3) keys.push(text.decode(reader.bytes()));
    else if (field === 4) values.push(decodeValue(reader.bytes()));
    else if (field === 5) extent = reader.varint();
    else reader.skip(wire);
  }
  const features = raw.map((featureBytes) => {
    const feature = protobuf(featureBytes);
    let type = 0;
    let geometry: number[] = [];
    const properties: Record<string, Value> = {};
    while (!feature.done) {
      const { field, wire } = feature.key();
      if (field === 2) {
        const tags = protobuf(feature.bytes());
        while (!tags.done) {
          const key = keys[tags.varint()];
          const value = values[tags.varint()];
          if (key !== undefined && value !== undefined) properties[key] = value;
        }
      } else if (field === 3) type = feature.varint();
      else if (field === 4) geometry = packed(feature.bytes());
      else feature.skip(wire);
    }
    return { type, geometry, properties };
  });
  return { name, extent, features };
}

/** Geometry commands to lines in tile units: MoveTo starts one, LineTo extends it. */
function linesOf(commands: readonly number[]): [number, number][][] {
  const lines: [number, number][][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  let current: [number, number][] | undefined;
  while (i < commands.length) {
    const header = commands[i++]!;
    const id = header & 0x7;
    const count = header >>> 3;
    if (id === 1 || id === 2) {
      for (let n = 0; n < count && i + 1 < commands.length; n++) {
        x += zigzag(commands[i++]!);
        y += zigzag(commands[i++]!);
        if (id === 1) {
          current = [];
          lines.push(current);
        }
        current?.push([x, y]);
      }
    } else if (id !== 7) {
      break;
    }
  }
  return lines;
}

function toLonLat(
  { z, x, y }: { readonly z: number; readonly x: number; readonly y: number },
  fx: number,
  fy: number,
): readonly [number, number] {
  const n = 2 ** z;
  const longitude = ((x + fx) / n) * 360 - 180;
  const latitude =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + fy)) / n))) * 180) / Math.PI;
  return [longitude, latitude];
}

const text = new TextDecoder();

function zigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function decodeValue(bytes: Uint8Array): Value | undefined {
  const reader = protobuf(bytes);
  let value: Value | undefined;
  while (!reader.done) {
    const { field, wire } = reader.key();
    if (field === 1) value = text.decode(reader.bytes());
    else if (field === 2) value = reader.fixed(4);
    else if (field === 3) value = reader.fixed(8);
    else if (field === 4 || field === 5) value = reader.varint();
    else if (field === 6) value = zigzag(reader.varint());
    else if (field === 7) value = reader.varint() !== 0;
    else reader.skip(wire);
  }
  return value;
}

function packed(bytes: Uint8Array): number[] {
  const reader = protobuf(bytes);
  const out: number[] = [];
  while (!reader.done) out.push(reader.varint());
  return out;
}

function protobuf(bytes: Uint8Array) {
  let position = 0;
  const varint = (): number => {
    let result = 0;
    let multiplier = 1;
    for (;;) {
      const byte = bytes[position++];
      if (byte === undefined) throw new Error("truncated varint");
      result += (byte & 0x7f) * multiplier;
      if (byte < 0x80) return result;
      multiplier *= 128;
    }
  };
  return {
    get done() {
      return position >= bytes.length;
    },
    varint,
    key() {
      const key = varint();
      return { field: Math.floor(key / 8), wire: key % 8 };
    },
    bytes() {
      const length = varint();
      const slice = bytes.subarray(position, position + length);
      position += length;
      return slice;
    },
    fixed(size: 4 | 8): number {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + position,
        size,
      );
      position += size;
      return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
    },
    skip(wire: number) {
      if (wire === 0) varint();
      else if (wire === 1) position += 8;
      else if (wire === 2) position += varint();
      else if (wire === 5) position += 4;
      else throw new Error(`unsupported wire type ${wire}`);
    },
  };
}
