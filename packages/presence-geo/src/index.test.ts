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
  it("lights only after dwell and appends a closing record on exit", async () => {
    const records: VisitRecord[] = [];
    let clock = 1_000_000;
    let tick: (() => void) | undefined;
    const tracker = createPresenceTracker({
      store: memoryStore(records),
      now: () => clock,
      setInterval(listener) {
        tick = listener;
        return 1 as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => undefined,
    });

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 8,
      observedAt: clock,
    });
    await settle();
    expect(records).toEqual([]);

    clock += 60_000;
    tick?.();
    await settle();
    expect(records).toHaveLength(1);
    expect(records[0]?.leftAt).toBeNull();

    clock += 1_000;
    tracker.observe({
      longitude: 30.54,
      latitude: 50.4501,
      accuracyMeters: 7,
      observedAt: clock,
    });
    await settle();
    expect(records).toHaveLength(2);
    expect(records[1]?.leftAt).toBe(1_061_000);
  });

  it("rejects inaccurate fixes", async () => {
    const records: VisitRecord[] = [];
    let tick: (() => void) | undefined;
    const tracker = createPresenceTracker({
      store: memoryStore(records),
      now: () => 60_000,
      setInterval(listener) {
        tick = listener;
        return 1 as ReturnType<typeof globalThis.setInterval>;
      },
      clearInterval: () => undefined,
    });

    tracker.observe({
      longitude: 30.5234,
      latitude: 50.4501,
      accuracyMeters: 200,
      observedAt: 0,
    });
    tick?.();
    await settle();
    expect(records).toEqual([]);
  });

  it("does not light a corridor of short transits", async () => {
    const records: VisitRecord[] = [];
    let clock = 0;
    const tracker = createPresenceTracker({
      store: memoryStore(records),
      now: () => clock,
      setInterval: () => 1 as ReturnType<typeof globalThis.setInterval>,
      clearInterval: () => undefined,
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
