// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  compareKinds,
  countKinds,
  createAreaKeyCheck,
  decodeLayerFeatures,
  mapperAreaKeys,
  mapperKinds,
  zoomOfTileId,
} from "../../deploy/web/landmark-kinds.mjs";
import AREA_KINDS from "../../packages/map-maplibre/src/landmark-area-kinds.json";
import MAPPER_KINDS from "../../packages/product-app/src/features/map/landmark-mapper-kinds.json";
import {
  POI_KIND_ROWS,
  POI_SIGNIFICANCE_KINDS,
} from "../../packages/product-app/src/features/map/landmark-mapper";

const SCRIPT = resolve(__dirname, "../../deploy/web/landmark-kinds.mjs");
const KINDS = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../packages/map-maplibre/src/landmark-kinds.json"),
    "utf8",
  ),
) as string[];

const REQUIRED = mapperKinds(MAPPER_KINDS);
const AREA_KEYS = mapperAreaKeys(MAPPER_KINDS);

// A minimal protobuf writer: enough to author a vector tile and a PMTiles
// directory by hand, so the check is exercised against real encodings.
function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
}
const field = (number: number, wire: number) => varint(number * 8 + wire);
const bytesField = (number: number, bytes: readonly number[]) => [
  ...field(number, 2),
  ...varint(bytes.length),
  ...bytes,
];
const utf8 = (value: string) => [...new TextEncoder().encode(value)];

interface Feature {
  id?: number;
  /** 1 point (the default), 3 polygon. */
  type?: number;
  properties: Record<string, string>;
}

function tile(layers: Record<string, Feature[]>): Uint8Array {
  const out: number[] = [];
  for (const [name, features] of Object.entries(layers)) {
    const keys: string[] = [];
    const values: string[] = [];
    const index = (list: string[], value: string) => {
      const at = list.indexOf(value);
      if (at >= 0) return at;
      list.push(value);
      return list.length - 1;
    };
    const encoded = features.map(({ id, type = 1, properties }) => {
      const tags = Object.entries(properties).flatMap(([key, value]) => [
        ...varint(index(keys, key)),
        ...varint(index(values, value)),
      ]);
      return [
        ...(id === undefined ? [] : [...field(1, 0), ...varint(id)]),
        ...bytesField(2, tags),
        ...field(3, 0),
        ...varint(type),
        // A real MVT feature also carries packed geometry. This specifically
        // exercises skipping a length-delimited field after tags.
        ...bytesField(4, [9, 0, 0]),
      ];
    });
    const layer = [
      ...field(15, 0),
      ...varint(2),
      ...bytesField(1, utf8(name)),
      ...encoded.flatMap((feature) => bytesField(2, feature)),
      ...keys.flatMap((key) => bytesField(3, utf8(key))),
      ...values.flatMap((value) => bytesField(4, bytesField(1, utf8(value)))),
    ];
    out.push(...bytesField(3, layer));
  }
  return Uint8Array.from(out);
}

/** A PMTiles v3 archive whose root directory points at gzipped tiles. */
function archive(
  tiles: { tileId: number; bytes: Uint8Array }[],
  maxZoom: number,
) {
  const payloads = tiles.map(({ bytes }) => gzipSync(bytes));
  let offset = 0;
  const offsets = payloads.map((payload) => {
    const at = offset;
    offset += payload.length;
    return at;
  });
  let previous = 0;
  const directory = gzipSync(
    Uint8Array.from([
      ...varint(tiles.length),
      ...tiles.flatMap(({ tileId }) => {
        const delta = tileId - previous;
        previous = tileId;
        return varint(delta);
      }),
      ...tiles.flatMap(() => varint(1)),
      ...payloads.flatMap((payload) => varint(payload.length)),
      ...offsets.flatMap((at) => varint(at + 1)),
    ]),
  );
  const header = new Uint8Array(127);
  header.set(new TextEncoder().encode("PMTiles"), 0);
  header[7] = 3;
  const view = new DataView(header.buffer);
  const rootOffset = 127;
  const dataOffset = rootOffset + directory.length;
  view.setBigUint64(8, BigInt(rootOffset), true);
  view.setBigUint64(16, BigInt(directory.length), true);
  view.setBigUint64(40, BigInt(dataOffset), true);
  view.setBigUint64(56, BigInt(dataOffset), true);
  header[97] = 2;
  header[98] = 2;
  header[101] = maxZoom;
  return Buffer.concat([header, directory, ...payloads]);
}

const FIRST_Z2_TILE = 1 + 4; // tile ids for zooms 0 and 1 come first

function write(bytes: Buffer): string {
  const path = join(
    mkdtempSync(join(tmpdir(), "landmark-kinds-")),
    "a.pmtiles",
  );
  writeFileSync(path, bytes);
  return path;
}

function run(path: string): {
  status: number;
  stdout: string;
  stderr: string;
} {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [SCRIPT, path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
      stderr: "",
    };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return {
      status: failed.status,
      stdout: failed.stdout,
      stderr: failed.stderr,
    };
  }
}

describe("checking LANDMARK_KINDS against a real archive", () => {
  it("reads the pois layer's kinds, and only that layer's", () => {
    const features = decodeLayerFeatures(
      tile({
        roads: [{ properties: { kind: "monument" } }],
        pois: [
          { id: 7, properties: { kind: "memorial", name: "Pam" } },
          { properties: { kind: "cafe" } },
        ],
      }),
      "pois",
    );

    expect(features).toEqual([
      { id: 7, type: 1, properties: { kind: "memorial", name: "Pam" } },
      { id: undefined, type: 1, properties: { kind: "cafe" } },
    ]);
  });

  it("counts a point shared by two tiles once", () => {
    const shared = { id: 7, type: 1, properties: { kind: "memorial" } };
    const kinds = countKinds([[shared], [shared]]);

    expect(kinds.get("memorial")?.count).toBe(1);
    expect(compareKinds(kinds, ["memorial", "statue"])).toEqual({
      present: ["memorial"],
      absent: ["statue"],
      missing: [],
      ok: true,
    });
    // A kind the mapper requires has to occur, whatever else does.
    expect(compareKinds(kinds, ["memorial"], ["memorial", "museum"])).toEqual({
      present: ["memorial"],
      absent: [],
      missing: ["museum"],
      ok: false,
    });
  });

  it("places tile ids on their zoom", () => {
    expect(zoomOfTileId(0)).toBe(0);
    expect(zoomOfTileId(1)).toBe(1);
    expect(zoomOfTileId(4)).toBe(1);
    expect(zoomOfTileId(FIRST_Z2_TILE)).toBe(2);
  });

  /**
   * One polygon per area key, `layer:kind` or `layer:kind:kind_detail`, and
   * the label it is joined by: a named `pois` point with a `landuse`
   * polygon's id, a named `water` point of a `water` polygon's kind.
   */
  const areaLayers = (except?: string) => {
    const layers: Record<"pois" | "landuse" | "water", Feature[]> = {
      pois: [],
      landuse: [],
      water: [],
    };
    AREA_KEYS.forEach((key, index) => {
      if (key === except) return;
      const [layer, kind, detail] = key.split(":") as [
        "landuse" | "water",
        string,
        string?,
      ];
      const properties = {
        kind,
        ...(detail === undefined ? {} : { kind_detail: detail }),
      };
      const id = 500 + index;
      if (layer === "landuse") {
        layers.landuse.push({ id, type: 3, properties });
        layers.pois.push({ id, properties: { kind, name: key } });
      } else {
        layers.water.push({ type: 3, properties });
        layers.water.push({ properties: { ...properties, name: key } });
      }
    });
    return layers;
  };

  /** An archive whose full-detail tile carries every kind the mapper reads. */
  const mapperArchive = (except?: string, zoomOne = "cafe") =>
    archive(
      [
        {
          tileId: 1,
          bytes: tile({ pois: [{ properties: { kind: zoomOne } }] }),
        },
        {
          tileId: FIRST_Z2_TILE,
          bytes: tile({
            pois: [
              ...REQUIRED.filter((kind) => kind !== except).map(
                (kind, index) => ({
                  id: index + 1,
                  properties: { kind, name: kind },
                }),
              ),
              { id: 1_000, properties: { kind: "cafe" } },
              ...areaLayers(except).pois,
            ],
            landuse: areaLayers(except).landuse,
            water: areaLayers(except).water,
          }),
        },
      ],
      2,
    );

  it("passes an archive that carries every kind the mapper reads", () => {
    const { status, stdout } = run(write(mapperArchive()));

    expect(status).toBe(0);
    expect(stdout).toContain("Avaia mapper absent:    none");
    expect(stdout).toContain("Avaia areas absent:     none");
  });

  it("fails an archive that lacks one area the mapper reads", () => {
    for (const key of ["landuse:park", "water:water:lake"]) {
      const { status, stdout, stderr } = run(write(mapperArchive(key)));

      expect(status, key).toBe(1);
      expect(stdout).toContain(`Avaia areas absent:     ${key}`);
      expect(stderr).toContain(key);
    }
  });

  it("counts an area only where the renderer can join it to its label", () => {
    const check = createAreaKeyCheck([
      "landuse:park",
      "landuse:beach",
      "water:lake",
      "water:water:lake",
    ]);
    const lake = { kind: "water", kind_detail: "lake" };
    check.add({
      // A park whose label comes in a later tile; a beach only as a point.
      landuse: [{ id: 1, type: 3, properties: { kind: "park" } }],
      pois: [{ id: 2, type: 1, properties: { kind: "beach", name: "Sand" } }],
      // A lake polygon whose label is a plain `lake` point: no join.
      water: [
        { id: undefined, type: 3, properties: lake },
        { id: undefined, type: 1, properties: { kind: "lake", name: "L" } },
      ],
    });
    expect([...check.found]).toEqual([]);

    check.add({
      pois: [{ id: 1, type: 1, properties: { kind: "park", name: "Park" } }],
      // Its label in another tile than the polygon does not join either.
      water: [
        { id: undefined, type: 1, properties: { ...lake, name: "Lake" } },
      ],
    });
    expect([...check.found]).toEqual(["landuse:park"]);

    check.add({
      water: [
        { id: undefined, type: 3, properties: lake },
        { id: undefined, type: 1, properties: { ...lake, name: "Lake" } },
      ],
    });
    expect([...check.found].sort()).toEqual([
      "landuse:park",
      "water:water:lake",
    ]);
  });

  it("decodes every area the mapper reads from the archive", () => {
    for (const key of AREA_KEYS) {
      const [layer, kind] = key.split(":") as [keyof typeof AREA_KINDS, string];
      expect(AREA_KINDS[layer], key).toContain(kind);
    }
  });

  it("fails an archive that lacks one kind the mapper reads", () => {
    for (const kind of ["museum", "landmark"]) {
      const { status, stdout, stderr } = run(write(mapperArchive(kind)));

      expect(status, kind).toBe(1);
      expect(stdout).toContain(`Avaia mapper absent:    ${kind}`);
      expect(stderr).toContain(kind);
    }
  });

  it("reads only the archive's max zoom", () => {
    // castle is only on the zoom-1 tile, which is not the archive's full
    // detail: it is not read, so the mapper's castle row is missing.
    const { status, stdout } = run(write(mapperArchive("castle", "castle")));

    expect(stdout).not.toMatch(/✓ castle/);
    expect(status).toBe(1);
  });

  it("fails an archive that carries none of them", () => {
    const path = write(
      archive(
        [
          {
            tileId: FIRST_Z2_TILE,
            bytes: tile({ pois: [{ properties: { kind: "cafe" } }] }),
          },
        ],
        2,
      ),
    );

    expect(run(path).status).toBe(1);
  });
});

describe("the Avaia's landmark mapper", () => {
  it("reads exactly the kinds the archive check requires", () => {
    expect(
      [...Object.keys(POI_KIND_ROWS), ...POI_SIGNIFICANCE_KINDS].sort(),
    ).toEqual([...REQUIRED].sort());
  });

  // The renderer only hands over points whose kind is in LANDMARK_KINDS, so a
  // mapper kind outside it would never reach the mapper at all.
  it("reads only kinds in LANDMARK_KINDS", () => {
    const known = new Set(KINDS);
    for (const kind of [
      ...Object.keys(POI_KIND_ROWS),
      ...POI_SIGNIFICANCE_KINDS,
    ]) {
      expect(known.has(kind), kind).toBe(true);
    }
  });
});
