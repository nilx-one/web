#!/usr/bin/env node
// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
//
// Lists the `kind` values the archive's `pois` layer actually carries, and
// checks the renderer's LANDMARK_KINDS against them. The renderer only treats
// a point as a landmark when its kind is on that list, so a kind the archive
// never uses would make landmarks quietly disappear. This is the check that
// catches it.
//
//   node deploy/web/landmark-kinds.mjs /srv/nilx-one/map/basemap.pmtiles
//
// It uses nothing but Node built-ins, so it runs on the server in a stock
// `node` container next to inspect-basemap.sh without an install step. It
// exits 1 when none of LANDMARK_KINDS occur in the archive.

import console from "node:console";
import { open, readFile } from "node:fs/promises";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import * as zlib from "node:zlib";

const POI_LAYER = "pois";

// ---- protobuf ------------------------------------------------------------

function reader(bytes) {
  let position = 0;
  const varint = () => {
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
    fixed(size) {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset + position,
        size,
      );
      position += size;
      return size === 4 ? view.getFloat32(0, true) : view.getFloat64(0, true);
    },
    skip(wire) {
      if (wire === 0) varint();
      else if (wire === 1) position += 8;
      else if (wire === 2) position += varint();
      else if (wire === 5) position += 4;
      else throw new Error(`unsupported wire type ${wire}`);
    },
  };
}

const text = new TextDecoder();

function decodeValue(bytes) {
  const r = reader(bytes);
  let value;
  while (!r.done) {
    const { field, wire } = r.key();
    if (field === 1) value = text.decode(r.bytes());
    else if (field === 2) value = r.fixed(4);
    else if (field === 3) value = r.fixed(8);
    else if (field === 4 || field === 5) value = r.varint();
    else if (field === 6) {
      const raw = r.varint();
      value = raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
    } else if (field === 7) value = r.varint() !== 0;
    else r.skip(wire);
  }
  return value;
}

/**
 * The properties of every feature in one layer of a Mapbox Vector Tile, with
 * the feature id when the tile carries one. Geometry is not decoded: what a
 * landmark is lives in its attributes.
 */
export function decodeLayerFeatures(tileBytes, layerName) {
  const tile = reader(tileBytes);
  while (!tile.done) {
    const { field, wire } = tile.key();
    if (field !== 3) {
      tile.skip(wire);
      continue;
    }
    const layer = reader(tile.bytes());
    let name;
    const keys = [];
    const values = [];
    const features = [];
    while (!layer.done) {
      const entry = layer.key();
      if (entry.field === 1) name = text.decode(layer.bytes());
      else if (entry.field === 2) features.push(layer.bytes());
      else if (entry.field === 3) keys.push(text.decode(layer.bytes()));
      else if (entry.field === 4) values.push(decodeValue(layer.bytes()));
      else layer.skip(entry.wire);
    }
    if (name !== layerName) continue;
    return features.map((bytes) => {
      const feature = reader(bytes);
      let id;
      const properties = {};
      while (!feature.done) {
        const entry = feature.key();
        if (entry.field === 1) id = feature.varint();
        else if (entry.field === 2) {
          const tags = reader(feature.bytes());
          while (!tags.done) {
            const key = keys[tags.varint()];
            const value = values[tags.varint()];
            if (key !== undefined) properties[key] = value;
          }
        } else feature.skip(entry.wire);
      }
      return { id, properties };
    });
  }
  return [];
}

/**
 * Counts `kind` across features, once per feature id where the archive gives
 * one — a point near a tile edge is carried by more than one tile.
 */
export function countKinds(featureLists) {
  const seen = new Set();
  const kinds = new Map();
  for (const features of featureLists) {
    for (const { id, properties } of features) {
      const kind = properties.kind;
      if (typeof kind !== "string") continue;
      if (id !== undefined) {
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      const entry = kinds.get(kind) ?? { count: 0, attributes: new Set() };
      entry.count += 1;
      for (const attribute of Object.keys(properties)) {
        entry.attributes.add(attribute);
      }
      kinds.set(kind, entry);
    }
  }
  return kinds;
}

/** What the archive carries, against what the renderer looks for. */
export function compareKinds(kinds, landmarkKinds) {
  const present = landmarkKinds.filter((kind) => kinds.has(kind));
  const absent = landmarkKinds.filter((kind) => !kinds.has(kind));
  return { present, absent, ok: present.length > 0 };
}

// ---- PMTiles v3 ----------------------------------------------------------

function decompress(bytes, compression) {
  switch (compression) {
    case 0:
    case 1:
      return bytes;
    case 2:
      return gunzipSync(bytes);
    case 3:
      return brotliDecompressSync(bytes);
    case 4:
      if (typeof zlib.zstdDecompressSync === "function") {
        return zlib.zstdDecompressSync(bytes);
      }
      throw new Error("zstd-compressed archive needs Node 22.15 or newer");
    default:
      throw new Error(`unknown compression ${compression}`);
  }
}

function readHeader(bytes) {
  if (text.decode(bytes.subarray(0, 7)) !== "PMTiles" || bytes[7] !== 3) {
    throw new Error("not a PMTiles v3 archive");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const u64 = (at) => Number(view.getBigUint64(at, true));
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    leafOffset: u64(40),
    tileDataOffset: u64(56),
    internalCompression: bytes[97],
    tileCompression: bytes[98],
    maxZoom: bytes[101],
  };
}

function decodeDirectory(bytes) {
  const r = reader(bytes);
  const count = r.varint();
  const entries = Array.from({ length: count }, () => ({}));
  let tileId = 0;
  for (const entry of entries) {
    tileId += r.varint();
    entry.tileId = tileId;
  }
  for (const entry of entries) entry.runLength = r.varint();
  for (const entry of entries) entry.length = r.varint();
  entries.forEach((entry, index) => {
    const raw = r.varint();
    const previous = entries[index - 1];
    entry.offset =
      raw === 0 && previous !== undefined
        ? previous.offset + previous.length
        : raw - 1;
  });
  return entries;
}

/** The zoom a Hilbert tile id belongs to. */
export function zoomOfTileId(tileId) {
  let zoom = 0;
  let base = 0;
  for (;;) {
    const next = base + 4 ** zoom;
    if (tileId < next) return zoom;
    base = next;
    zoom += 1;
  }
}

async function* maxZoomTiles(path) {
  const file = await open(path, "r");
  try {
    const read = async (offset, length) => {
      const buffer = new Uint8Array(length);
      await file.read(buffer, 0, length, offset);
      return buffer;
    };
    const header = readHeader(await read(0, 127));
    const pending = [[header.rootOffset, header.rootLength]];
    const visited = new Set();
    while (pending.length > 0) {
      const [offset, length] = pending.pop();
      const directory = decodeDirectory(
        decompress(await read(offset, length), header.internalCompression),
      );
      for (const entry of directory) {
        if (entry.runLength === 0) {
          pending.push([header.leafOffset + entry.offset, entry.length]);
          continue;
        }
        if (zoomOfTileId(entry.tileId) !== header.maxZoom) continue;
        // Runs of identical tiles share one payload; reading it once is enough.
        if (visited.has(entry.offset)) continue;
        visited.add(entry.offset);
        yield decompress(
          await read(header.tileDataOffset + entry.offset, entry.length),
          header.tileCompression,
        );
      }
    }
  } finally {
    await file.close();
  }
}

// ---- CLI -----------------------------------------------------------------

async function main(argv) {
  const [path] = argv;
  if (path === undefined) {
    console.error("usage: landmark-kinds.mjs <basemap.pmtiles>");
    return 2;
  }
  const kindsFile =
    process.env.LANDMARK_KINDS_PATH ??
    fileURLToPath(
      new URL(
        "../../packages/map-maplibre/src/landmark-kinds.json",
        import.meta.url,
      ),
    );
  const landmarkKinds = JSON.parse(await readFile(kindsFile, "utf8"));

  const lists = [];
  for await (const tile of maxZoomTiles(path)) {
    lists.push(decodeLayerFeatures(tile, POI_LAYER));
  }
  const kinds = countKinds(lists);
  const wanted = new Set(landmarkKinds);

  console.log(`pois kinds in ${path} (${kinds.size}):`);
  for (const [kind, { count, attributes }] of [...kinds].sort(
    (a, b) => b[1].count - a[1].count,
  )) {
    const mark = wanted.has(kind) ? "✓" : " ";
    console.log(
      `  ${mark} ${kind.padEnd(24)} ${String(count).padStart(6)}  ${[...attributes].sort().join(", ")}`,
    );
  }

  const { present, absent, ok } = compareKinds(kinds, landmarkKinds);
  console.log();
  console.log(`LANDMARK_KINDS present: ${present.join(", ") || "none"}`);
  console.log(`LANDMARK_KINDS absent:  ${absent.join(", ") || "none"}`);
  if (!ok) {
    console.error(
      "No LANDMARK_KINDS occur in this archive: landmarks would never be found.",
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
