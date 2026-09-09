// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  VisitRecord,
} from "@nilx-one/presence-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPresenceTracker } from "./index";

function memoryStore(records: VisitRecord[]): PresenceStore {
  return {
    async append(record) {
      records.push(record);
    },
    async listCells() {
      return [];
    },
    async recordsForCell(_cell: CellIndex) {
      return [];
    },
    subscribe() {
      return () => undefined;
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => vi.restoreAllMocks());

describe("presence tracker", () => {
  it("lights only after accepted fixes span the dwell and appends a closing record on exit", async () => {
    const records: VisitRecord[] = [];
    const tracker = createPresenceTracker({
      store: memoryStore(records),
    });

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 8,
      observedAt: 1_000_000,
    });
    await settle();
    expect(records).toEqual([]);

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 6,
      observedAt: 1_060_000,
    });
    await settle();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      leftAt: null,
      fixCount: 2,
      bestAccuracyM: 6,
    });

    tracker.observe({
      longitude: 30.54,
      latitude: 50.4501,
      accuracyMeters: 7,
      observedAt: 1_061_000,
    });
    await settle();
    expect(records).toHaveLength(2);
    expect(records[1]?.leftAt).toBe(1_060_000);
  });

  it("never turns one accurate fix into presence without later evidence", async () => {
    const records: VisitRecord[] = [];
    const tracker = createPresenceTracker({
      store: memoryStore(records),
      dwellMs: 60_000,
    });

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 8,
      observedAt: 1_000_000,
    });
    tracker.stop();
    await settle();

    expect(records).toEqual([]);
  });

  it("rejects inaccurate fixes", async () => {
    const records: VisitRecord[] = [];
    const tracker = createPresenceTracker({
      store: memoryStore(records),
    });

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 200,
      observedAt: 0,
    });
    tracker.stop();
    await settle();
    expect(records).toEqual([]);
  });

  it("does not light a corridor of short transits", async () => {
    const records: VisitRecord[] = [];
    let clock = 0;
    const tracker = createPresenceTracker({
      store: memoryStore(records),
    });

    for (const longitude of [30.5, 30.52, 30.54, 30.56, 30.58]) {
      tracker.observe({
        longitude,
        latitude: 50.4501,
        accuracyMeters: 10,
        observedAt: clock,
      });
      clock += 10_000;
    }
    tracker.stop();
    await settle();
    expect(records).toEqual([]);
  });
});
