// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapFogField,
  MapLandmark,
} from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
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
});
