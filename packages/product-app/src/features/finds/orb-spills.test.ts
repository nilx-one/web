// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  findPoint,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import type { MapFogField, MapLandmark } from "@nilx-one/map-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  answerCell,
  EMPTY_CELL_ORB_STORE,
  fromCoordinate,
  knownCell,
  openCell,
  pickCellOrbs,
  readCellOrbStore,
  settleCells,
  writeCellOrbStore,
  knownSpill,
  landmarkWaypoint,
  mapOrbs,
  orbWorldInput,
  refreshSpill,
  toCoordinate,
} from "./orb-spills";

const roll: Pick<FindRoll, "artifactId" | "segment" | "placement"> = {
  artifactId: "art:seg:312346:298243:e2961:1:0",
  segment: "seg:312346:298243",
  placement: { along: 0.5, across: 0.2 },
};
const center: LonLat = [30.4461, 50.465];
const view = {
  sha: "ab".padEnd(64, "0"),
  count: 12,
  expiresAt: 1_801_000,
  taken: [1],
};

describe("orbs between the map and Core", () => {
  it("keeps the service's answer, leading from the find's cell to the find", () => {
    const spill = knownSpill(view, roll, () => center, 1_000);
    expect(spill).toMatchObject({
      artifactId: roll.artifactId,
      count: 12,
      taken: [1],
      from: center,
      to: findPoint(roll),
      appearedAt: 1_000,
    });
    const fresher = refreshSpill(spill, { ...view, taken: [0, 1] });
    expect(fresher.taken).toEqual([0, 1]);
    expect(fresher.from).toEqual(spill.from);
  });

  it("asks Core in its own wire: E7 decimals and decimal times", () => {
    const spill = knownSpill(view, roll, () => center, 1_000);
    const input = orbWorldInput([spill], new Set(["orb:x"]), undefined, {
      longitude: 30.4469,
      latitude: 50.4655,
    });
    expect(input).toEqual({
      spills: [
        {
          artifact_id: roll.artifactId,
          from: { longitude_e7: "304461000", latitude_e7: "504650000" },
          to: toCoordinate(findPoint(roll)),
          appeared_at: "1000",
          expires_at: "1801000",
          count: 12,
          taken: [1],
        },
      ],
      picked: ["orb:x"],
      bond: null,
      avaia: { longitude_e7: "304469000", latitude_e7: "504655000" },
    });
    expect(fromCoordinate(toCoordinate([-0.0000001, 0]))).toEqual([-1e-7, 0]);
    expect(toCoordinate([0, -0.00000001])).toEqual({
      longitude_e7: "0",
      latitude_e7: "0",
    });
  });

  it("selects a real same-cell monument as a stable route waypoint", () => {
    const [longitude, latitude] = findPoint(roll);
    const fog = {
      cellAt: (point: { longitude: number }) => ({
        id: point.longitude < 31 ? "here" : "elsewhere",
        center: { longitude, latitude },
        boundary: [],
      }),
    } as unknown as MapFogField;
    const candidates: MapLandmark[] = [
      {
        id: "faraway",
        longitude: 31.01,
        latitude,
        kind: "monument",
        facts: {},
      },
      {
        id: "ordinary",
        longitude: longitude + 0.00001,
        latitude,
        kind: "viewpoint",
        facts: {},
      },
      {
        id: "memorial",
        longitude: longitude + 0.0003,
        latitude,
        kind: "monument",
        facts: {},
      },
    ];
    const select = () => landmarkWaypoint(roll, fog, () => candidates);
    expect(select()).toEqual([longitude + 0.0003, latitude]);
    expect(select()).toEqual(select());
    expect(landmarkWaypoint(roll, fog, () => [])).toBeUndefined();

    const spill = knownSpill(view, roll, () => center, 1_000, select());
    const legacy = orbWorldInput([spill], new Set(), undefined, undefined);
    expect(legacy.spills[0]).not.toHaveProperty("via");
    const guided = orbWorldInput(
      [spill],
      new Set(),
      undefined,
      undefined,
      true,
    );
    expect(guided.spills[0]).toMatchObject({
      via: toCoordinate([longitude + 0.0003, latitude]),
      to: toCoordinate(findPoint(roll)),
    });
  });

  it("draws exactly what Core laid out", () => {
    expect(
      mapOrbs({
        orbs: [
          {
            id: "orb:a:0",
            kind: "orb",
            at: { longitude_e7: "304469000", latitude_e7: "504655000" },
            lands_at: "1070",
          },
        ],
        bond_reach: [],
        avaia_reach: [],
        next_expiry: null,
      }),
    ).toEqual([
      {
        id: "orb:a:0",
        kind: "orb",
        longitude: 30.4469,
        latitude: 50.4655,
        landsAt: 1070,
      },
    ]);
  });
});

describe("the cell orb store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.localStorage.clear();
  });

  const cellId = (n: number) => `89${n.toString(16).padStart(13, "0")}`;
  const keyOf = (n: number) => n.toString(16).padStart(64, "0");
  const answered = (n: number) =>
    knownCell(
      cellId(n),
      {
        key: keyOf(n),
        center: { longitude_e7: "304469000", latitude_e7: "504655000" },
        registry: 1,
        ratedLandmarks: [],
      },
      n,
    );

  it("keeps every uncollected cell, however many, across a reload", () => {
    let store = EMPTY_CELL_ORB_STORE;
    for (let n = 0; n < 2_500; n += 1) store = answerCell(store, answered(n));
    expect(writeCellOrbStore("0x0sky", store)).toBe(true);
    const read = readCellOrbStore("0x0sky");
    expect(read.cells.size).toBe(2_500);
    expect(read.cells.get(cellId(0))).toEqual(answered(0));
    // Another Bond's record is its own.
    expect(readCellOrbStore("0x1sky").cells.size).toBe(0);
  });

  it("keeps a spill owed until it is answered, across a reload", () => {
    const owed = openCell(EMPTY_CELL_ORB_STORE, cellId(1));
    expect([...owed.pending]).toEqual([cellId(1)]);
    writeCellOrbStore("0x0sky", owed);
    const read = readCellOrbStore("0x0sky");
    expect([...read.pending]).toEqual([cellId(1)]);
    const lying = answerCell(read, answered(1));
    expect(lying.pending.size).toBe(0);
    expect(lying.cells.has(cellId(1))).toBe(true);
    // Opening it again owes nothing new.
    expect(openCell(lying, cellId(1))).toBe(lying);
  });

  it("marks a fully collected cell done, forever, and lets its picks go", () => {
    const orbs = [0, 1, 2, 3, 4].map((n) => `orb:cell:${keyOf(7)}:1:~:${n}`);
    let store = answerCell(EMPTY_CELL_ORB_STORE, answered(7));
    store = pickCellOrbs(store, orbs.slice(0, 3));
    // Two still lie: not done.
    expect(settleCells(store, [cellId(7)], new Set(orbs.slice(3)))).toBe(store);
    // A cell the answer was not asked about is not judged.
    expect(settleCells(store, [], new Set())).toBe(store);
    store = settleCells(
      pickCellOrbs(store, orbs.slice(3)),
      [cellId(7)],
      new Set(),
    );
    expect(store.cells.has(cellId(7))).toBe(false);
    expect(store.picked.size).toBe(0);
    expect([...store.done]).toEqual([cellId(7)]);
    // Revisited, it owes nothing and is never laid again.
    expect(openCell(store, cellId(7))).toBe(store);
    expect(answerCell(store, answered(7)).cells.has(cellId(7))).toBe(false);
    writeCellOrbStore("0x0sky", store);
    expect([...readCellOrbStore("0x0sky").done]).toEqual([cellId(7)]);
  });

  it("drops nothing when the browser refuses the write", () => {
    const store = answerCell(EMPTY_CELL_ORB_STORE, answered(3));
    writeCellOrbStore("0x0sky", store);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const bigger = answerCell(store, answered(4));
    expect(writeCellOrbStore("0x0sky", bigger)).toBe(false);
    // The last written record still holds; the caller keeps `bigger`.
    expect(readCellOrbStore("0x0sky").cells.size).toBe(1);
  });
});
