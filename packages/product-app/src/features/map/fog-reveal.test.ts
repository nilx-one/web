// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapFogField,
  MapLandmark,
  MapPointSelection,
} from "@nilx-one/map-contract";
import {
  epochOf,
  FIND_PACK_ID,
  rollSegment,
  ROLL_TABLE,
  segmentAt,
  segmentsWithin,
} from "@nilx-one/artifact-contract";
import { describe, expect, it } from "vitest";

import {
  approachPoint,
  artifactsInCell,
  avaiaInReach,
  awaitReveal,
  beginReveal,
  distanceToFogCellEdgeMeters,
  FOG_APPROACH_MAX_STEP_OUT_METERS,
  FOG_REVEAL_REACH_METERS,
  FOG_NEARBY_REVEAL_METERS,
  FOG_REVEAL_CONCURRENCY,
  FOG_REVEAL_MAX_MS,
  FOG_REVEAL_MIN_MS,
  fogMarks,
  freezeUnattended,
  landmarksInCell,
  offerFor,
  readAuthorizedAt,
  readRevealJobs,
  revealDurationMs,
  revealFinished,
  revealProgress,
  revealRemainingMs,
  startReveal,
  writeAuthorizedAt,
  writeRevealJobs,
  type FogRevealStorage,
} from "./fog-reveal";

function cell(id: string, longitude = 30.52): MapFogCell {
  return {
    id,
    center: { longitude, latitude: 50.45 },
    boundary: [
      [longitude - 0.001, 50.449],
      [longitude + 0.001, 50.449],
      [longitude, 50.451],
    ],
  };
}

function memoryStorage(): FogRevealStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("revealing a fog cell", () => {
  it("takes a minute for bare ground and a minute more per landmark, never past five", () => {
    expect(revealDurationMs(0)).toBe(FOG_REVEAL_MIN_MS);
    expect(revealDurationMs(1)).toBe(2 * 60_000);
    expect(revealDurationMs(4)).toBe(FOG_REVEAL_MAX_MS);
    expect(revealDurationMs(40)).toBe(FOG_REVEAL_MAX_MS);
    expect(revealDurationMs(Number.NaN)).toBe(FOG_REVEAL_MIN_MS);
    expect(FOG_REVEAL_MAX_MS).toBe(5 * 60_000);
  });

  it("measures the nearest geographic cell edge, not the cell centre", () => {
    const neighbour: MapFogCell = {
      id: "east",
      center: { longitude: 30.53, latitude: 50.45 },
      boundary: [
        [30.525, 50.449],
        [30.535, 50.449],
        [30.535, 50.451],
        [30.525, 50.451],
      ],
    };
    expect(
      distanceToFogCellEdgeMeters(
        { longitude: 30.5249, latitude: 50.45 },
        neighbour,
      ),
    ).toBeLessThan(FOG_NEARBY_REVEAL_METERS);
    expect(
      distanceToFogCellEdgeMeters(
        { longitude: 30.5247, latitude: 50.45 },
        neighbour,
      ),
    ).toBeGreaterThan(FOG_NEARBY_REVEAL_METERS);
    expect(
      distanceToFogCellEdgeMeters(
        { longitude: Number.NaN, latitude: 50.45 },
        neighbour,
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("counts only the landmarks that stand in the cell itself", () => {
    const here = cell("here");
    const landmark = (id: string, longitude: number): MapLandmark => ({
      id,
      longitude,
      latitude: 50.45,
      kind: "monument",
      facts: {},
    });
    const fog = {
      cellAt: (point: { longitude: number }) =>
        point.longitude < 30.53 ? here : cell("there", 30.54),
    } as unknown as MapFogField;

    expect(
      landmarksInCell(fog, here, () => [
        landmark("a", 30.52),
        landmark("b", 30.521),
        landmark("c", 30.54),
      ]),
    ).toBe(2);
  });

  it("goes from nothing to done over its duration", () => {
    const job = startReveal(cell("a"), 1, 1_000);
    expect(revealProgress(job, 1_000)).toBe(0);
    expect(revealProgress(job, 1_000 + 60_000)).toBeCloseTo(0.5);
    expect(revealFinished(job, 1_000 + 119_999)).toBe(false);
    expect(revealFinished(job, 1_000 + 120_000)).toBe(true);
    expect(revealProgress(job, 1_000 + 999_999)).toBe(1);
  });

  it("runs no clock for a cell the Avaia has not reached, then its full time", () => {
    const waiting = awaitReveal(cell("a"), 1, 1_000);
    expect(waiting.waiting).toBe(true);
    expect(revealProgress(waiting, 1_000 + 999_999)).toBe(0);
    expect(revealFinished(waiting, 1_000 + 999_999)).toBe(false);
    expect(revealRemainingMs(waiting, 1_000 + 999_999)).toBe(120_000);
    // Waiting is not a held reveal: a reopened page leaves it as it is.
    expect(freezeUnattended([waiting], 5_000, 9_000)).toEqual([waiting]);

    const begun = beginReveal(waiting, 500_000);
    expect(begun).not.toHaveProperty("waiting");
    expect(begun.startedAt).toBe(500_000);
    expect(revealRemainingMs(begun, 500_000)).toBe(120_000);
    expect(revealFinished(begun, 500_000 + 119_999)).toBe(false);
    expect(revealFinished(begun, 500_000 + 120_000)).toBe(true);
  });

  it("keeps a waiting reveal across a reopened page", () => {
    const storage = memoryStorage();
    const waiting = awaitReveal(cell("a"), 0, 1_000);
    writeRevealJobs("0x0sky", [waiting], storage);
    expect(readRevealJobs("0x0sky", storage)).toEqual([waiting]);
  });

  it("counts the Avaia as arrived within 15 m of the cell's edge, never from an unknown place", () => {
    expect(FOG_REVEAL_REACH_METERS).toBe(15);
    const target = cell("a");
    // 0.0001 degrees of longitude is about 7 m at this latitude.
    const west = target.center.longitude - 0.001;
    expect(
      avaiaInReach({ longitude: west - 0.0001, latitude: 50.449 }, target),
    ).toBe(true);
    expect(
      avaiaInReach({ longitude: west - 0.0004, latitude: 50.449 }, target),
    ).toBe(false);
    expect(avaiaInReach(undefined, target)).toBe(false);
  });

  it("sends her to a stand where the work on a real H3 cell can begin", () => {
    // `cellToBoundary` of H3 resolution 9 cell 891e6384a2fffff, in Kyiv, as
    // map-shade stores it: about 21 m from its centre's 12% stand-off.
    const h3: MapFogCell = {
      id: "891e6384a2fffff",
      center: { longitude: 30.522204918821306, latitude: 50.44928996472307 },
      boundary: [
        [30.51988464334776, 50.45034397546152],
        [30.519601780567207, 50.44866325217777],
        [30.52192200723311, 50.447609226985996],
        [30.524525110599924, 50.44823589891277],
        [30.524808084139888, 50.44991660911516],
        [30.522487843556323, 50.45097066047351],
      ],
    };
    const inside = ({ longitude, latitude }: MapPointSelection) => {
      let within = false;
      const ring = h3.boundary;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (
          yi > latitude !== yj > latitude &&
          longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
        ) {
          within = !within;
        }
      }
      return within;
    };
    // Every edge, by approaching from far beyond each of them.
    for (const [longitude, latitude] of h3.boundary) {
      const from = {
        longitude: h3.center.longitude + (longitude - h3.center.longitude) * 40,
        latitude: h3.center.latitude + (latitude - h3.center.latitude) * 40,
      };
      const stand = approachPoint(h3, () => true, from);
      expect(inside(stand)).toBe(false);
      const meters = distanceToFogCellEdgeMeters(stand, h3);
      expect(meters).toBeGreaterThan(0);
      expect(meters).toBeLessThanOrEqual(FOG_APPROACH_MAX_STEP_OUT_METERS);
      expect(avaiaInReach(stand, h3)).toBe(true);
    }
  });

  it("pauses a distant reveal without accumulating blocked time", () => {
    const job = startReveal(cell("a"), 4, 1_000, 600_000);
    const paused = { ...job, pausedAt: 61_000 };
    expect(revealProgress(paused, 2_000_000)).toBe(0.1);
    expect(revealRemainingMs(paused, 2_000_000)).toBe(540_000);
    expect(revealFinished(paused, 2_000_000)).toBe(false);

    const resumedAt = 121_000;
    const resumed = {
      ...paused,
      startedAt: paused.startedAt + resumedAt - paused.pausedAt,
      pausedAt: undefined,
    };
    expect(revealRemainingMs(resumed, resumedAt)).toBe(540_000);
    expect(revealFinished(resumed, resumedAt + 539_999)).toBe(false);
    expect(revealFinished(resumed, resumedAt + 540_000)).toBe(true);
    const storage = memoryStorage();
    writeRevealJobs("0x0sky", [paused], storage);
    expect(readRevealJobs("0x0sky", storage)).toEqual([paused]);
  });

  it("offers a cell in reach, and no more than three at once", () => {
    const frontier = [cell("a"), cell("b"), cell("c"), cell("d")];
    const jobs = frontier.slice(0, 2).map((value) => startReveal(value, 0, 0));

    expect(offerFor("c", frontier, jobs).kind).toBe("offer");
    expect(offerFor("a", frontier, jobs).kind).toBe("revealing");
    expect(offerFor("far", frontier, jobs).kind).toBe("out-of-reach");

    const full = [...jobs, startReveal(cell("c"), 0, 0)];
    expect(full).toHaveLength(FOG_REVEAL_CONCURRENCY);
    expect(offerFor("d", frontier, full).kind).toBe("busy");
  });

  it("marks cells in reach and cells being worked open, never both for one", () => {
    const frontier = [cell("a"), cell("b")];
    const jobs = [startReveal(cell("a"), 0, 0)];
    const marks = fogMarks(frontier, jobs, 30_000);

    expect(marks).toEqual([
      { cell: frontier[1], state: "available" },
      { cell: frontier[0], state: "revealing", progress: 0.5 },
    ]);
  });

  it("remembers what was being revealed per Bond, and refuses what it cannot read", () => {
    const storage = memoryStorage();
    const jobs = [startReveal(cell("a"), 2, 5_000)];
    writeRevealJobs("0x0sky", jobs, storage);

    expect(readRevealJobs("0x0sky", storage)).toEqual(jobs);
    expect(readRevealJobs("0x0alice", storage)).toEqual([]);

    storage.setItem(
      "nilx-one.fog.jobs.v1.0x0sky",
      JSON.stringify([{ cell: { id: "a" } }, ...jobs]),
    );
    expect(readRevealJobs("0x0sky", storage)).toEqual(jobs);
    storage.setItem("nilx-one.fog.jobs.v1.0x0sky", "{");
    expect(readRevealJobs("0x0sky", storage)).toEqual([]);
  });

  it("keeps the evidence that time was authorized, per Bond, and distrusts the rest", () => {
    const storage = memoryStorage();
    expect(readAuthorizedAt("0x0sky", storage)).toBeUndefined();
    writeAuthorizedAt("0x0sky", 42_000.9, storage);
    expect(readAuthorizedAt("0x0sky", storage)).toBe(42_000);
    expect(readAuthorizedAt("0x0alice", storage)).toBeUndefined();
    for (const bad of ["x", "-5", "NaN", "Infinity", ""]) {
      storage.setItem("nilx-one.fog.authorized.v1.0x0sky", bad);
      expect(readAuthorizedAt("0x0sky", storage)).toBeUndefined();
    }
  });

  describe("a job found running by a reopened page", () => {
    const running = startReveal(cell("a"), 0, 10_000, 600_000);

    it("stops where Core last allowed it, never at the reopening", () => {
      const [frozen] = freezeUnattended([running], 130_000, 9_000_000);
      expect(frozen?.pausedAt).toBe(130_000);
      expect(revealRemainingMs(frozen!, 9_000_000)).toBe(480_000);
      expect(revealFinished(frozen!, 9_000_000)).toBe(false);
    });

    it("is never credited past now or before its own start", () => {
      expect(freezeUnattended([running], 99_999_999, 50_000)[0]?.pausedAt).toBe(
        50_000,
      );
      expect(freezeUnattended([running], 1, 50_000)[0]?.pausedAt).toBe(10_000);
    });

    it("gets nothing at all when there is no evidence", () => {
      const [frozen] = freezeUnattended([running], undefined, 9_000_000);
      expect(frozen?.pausedAt).toBe(10_000);
      expect(revealRemainingMs(frozen!, 9_000_000)).toBe(600_000);
    });

    it("leaves a job that is already paused exactly as it was", () => {
      const paused = { ...running, pausedAt: 70_000 };
      expect(freezeUnattended([paused], 130_000, 9_000_000)).toEqual([paused]);
    });
  });

  describe("the artifacts lying in a cell", () => {
    const NOW = Date.UTC(2026, 9, 8);
    const rolled = (segment: ReturnType<typeof segmentAt>): boolean =>
      rollSegment({
        packId: FIND_PACK_ID,
        packVersion: ROLL_TABLE.version,
        epoch: epochOf(NOW),
        segment,
      }) !== null;
    /** A cell about 8 m across, so it holds exactly the segment it stands in. */
    const tiny = (longitude: number, latitude: number): MapFogCell => ({
      id: `tiny:${longitude}:${latitude}`,
      center: { longitude, latitude },
      boundary: [
        [longitude - 0.00005, latitude - 0.00004],
        [longitude + 0.00005, latitude - 0.00004],
        [longitude + 0.00005, latitude + 0.00004],
        [longitude - 0.00005, latitude + 0.00004],
      ],
    });
    /** Walk the Kyiv grid for a segment that holds a find and one that does not. */
    function pointsFor() {
      let withFind: [number, number] | undefined;
      let bare: [number, number] | undefined;
      for (let i = 0; i < 4_000 && (!withFind || !bare); i++) {
        const point: [number, number] = [
          30.5 + i * 0.0006,
          50.4 + (i % 7) * 0.0005,
        ];
        if (rolled(segmentAt(point))) withFind ??= point;
        else bare ??= point;
      }
      return { withFind: withFind!, bare: bare! };
    }

    it("counts the find a segment rolls, and nothing for bare ground", () => {
      const { withFind, bare } = pointsFor();
      expect(artifactsInCell(tiny(...withFind), NOW)).toBe(1);
      expect(artifactsInCell(tiny(...bare), NOW)).toBe(0);
    });

    it("is the rolls of the segments the cell holds, whole cell or not", () => {
      const cellAcross = (longitude: number, latitude: number): MapFogCell => ({
        id: "wide",
        center: { longitude, latitude },
        boundary: [
          [longitude - 0.006, latitude - 0.004],
          [longitude + 0.006, latitude - 0.004],
          [longitude + 0.006, latitude + 0.004],
          [longitude - 0.006, latitude + 0.004],
        ],
      });
      const wide = cellAcross(30.5234, 50.4501);
      const expected = segmentsWithin(wide.boundary).filter(rolled).length;
      expect(artifactsInCell(wide, NOW)).toBe(expected);
      // About a hundred segments at 2.4% each: a few, never the whole lot.
      expect(expected).toBeLessThan(20);
    });

    it("answers the same for everyone on the same day", () => {
      const cell = tiny(30.5234, 50.4501);
      expect(artifactsInCell(cell, NOW)).toBe(
        artifactsInCell(cell, NOW + 3_600_000),
      );
    });
  });
});
