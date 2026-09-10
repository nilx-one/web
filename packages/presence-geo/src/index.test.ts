// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationObserver,
  GeolocationPermission,
} from "@nilx-one/host-contract";
import type { PresenceStore, VisitRecord } from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";
import { describe, expect, it, vi } from "vitest";

import { ACCURACY_GATE_M, DWELL_MS, createPresenceCapture } from "./index";

// Two points far enough apart to be different res-9 cells, and one a few
// metres from the first so it is certainly the same cell.
const HOME = { latitude: 50.4501, longitude: 30.5234 };
const AWAY = { latitude: 50.462, longitude: 30.5234 };

function recordingStore(): PresenceStore & { records: VisitRecord[] } {
  const records: VisitRecord[] = [];
  return {
    records,
    async append(record) {
      records.push(record);
    },
    async listCells() {
      return [...new Set(records.map((record) => record.cell))];
    },
    async recordsForCell(cell) {
      return records.filter((record) => record.cell === cell);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function fakeGeolocation(
  permission: GeolocationPermission = "granted",
): GeolocationCapability & {
  emit(
    point: { latitude: number; longitude: number },
    accuracyMeters: number,
    observedAt: number,
  ): void;
  fail(reason: "position-unavailable" | "unsupported"): void;
  stopped: () => number;
  request: () => unknown;
} {
  let observer: GeolocationObserver | undefined;
  let stops = 0;
  let request: unknown;
  return {
    async readPermission() {
      return permission;
    },
    async requestPosition() {
      return { kind: "failed", reason: "unsupported" } as const;
    },
    watchPosition(next, options) {
      observer = next;
      request = options;
      return () => {
        stops += 1;
        observer = undefined;
      };
    },
    emit(point, accuracyMeters, observedAt) {
      observer?.({
        kind: "observed",
        position: { ...point, accuracyMeters, observedAt },
      });
    },
    fail(reason) {
      observer?.({ kind: "failed", reason });
    },
    stopped: () => stops,
    request: () => request,
  };
}

/**
 * Appends are serialised through a promise chain, so a closing record lands a
 * turn after the open record it closes. Draining on a macrotask waits for the
 * whole chain rather than a fixed number of microtask ticks.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("presence capture gates", () => {
  it("asks the host for a high-accuracy, uncached watch", async () => {
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation,
    });

    await capture.start();

    expect(geolocation.request()).toEqual({
      highAccuracy: true,
      maximumAgeMs: 0,
    });
  });

  it("ignores a fix too coarse to name a cell", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, ACCURACY_GATE_M + 1, 0);
    geolocation.emit(HOME, ACCURACY_GATE_M + 1, DWELL_MS * 3);
    await settle();

    expect(store.records).toEqual([]);
    expect(capture.currentCell()).toBeUndefined();
  });

  it("accepts a fix exactly at the gate", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, ACCURACY_GATE_M, 0);
    await settle();

    expect(capture.currentCell()).toBe(
      latLngToCell(HOME.latitude, HOME.longitude, 9),
    );
  });

  it("does not light a cell merely passed through", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 10, 0);
    geolocation.emit(HOME, 10, DWELL_MS - 1);
    geolocation.emit(AWAY, 10, DWELL_MS);
    await settle();

    expect(store.records).toEqual([]);
  });

  it("lights a cell once the dwell is earned", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 30, 0);
    geolocation.emit(HOME, 12, DWELL_MS);
    await settle();

    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      cell: latLngToCell(HOME.latitude, HOME.longitude, 9),
      enteredAt: 0,
      leftAt: null,
      source: "self",
      fixCount: 2,
      bestAccuracyM: 12,
    });
  });

  it("writes the open record only once however long the dwell runs", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 20, 0);
    geolocation.emit(HOME, 20, DWELL_MS);
    geolocation.emit(HOME, 20, DWELL_MS * 2);
    geolocation.emit(HOME, 20, DWELL_MS * 3);
    await settle();

    expect(store.records).toHaveLength(1);
  });

  it("closes a lit visit on the way out and opens the next dwell", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 20, 0);
    geolocation.emit(HOME, 20, DWELL_MS);
    geolocation.emit(AWAY, 20, DWELL_MS + 5_000);
    await settle();

    expect(store.records).toHaveLength(2);
    expect(store.records[1]).toMatchObject({
      cell: latLngToCell(HOME.latitude, HOME.longitude, 9),
      enteredAt: 0,
      leftAt: DWELL_MS + 5_000,
    });
    expect(capture.currentCell()).toBe(
      latLngToCell(AWAY.latitude, AWAY.longitude, 9),
    );
  });

  it("keeps the best accuracy seen across the visit", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 40, 0);
    geolocation.emit(HOME, 6, 1_000);
    geolocation.emit(HOME, 25, DWELL_MS);
    await settle();

    expect(store.records[0]?.bestAccuracyM).toBe(6);
  });

  it("treats a dropped fix as a gap, not a departure", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();

    geolocation.emit(HOME, 20, 0);
    geolocation.fail("position-unavailable");
    geolocation.emit(HOME, 20, DWELL_MS);
    await settle();

    expect(store.records).toHaveLength(1);
    expect(store.records[0]?.enteredAt).toBe(0);
  });

  it("reports failures to a surface that wants them", async () => {
    const geolocation = fakeGeolocation();
    const onFailure = vi.fn();
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation,
      onFailure,
    });
    await capture.start();

    geolocation.fail("position-unavailable");

    expect(onFailure).toHaveBeenCalledWith("position-unavailable");
  });

  it("honours tuned gates", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({
      store,
      geolocation,
      accuracyGateM: 5,
      dwellMs: 1_000,
    });
    await capture.start();

    geolocation.emit(HOME, 8, 0);
    geolocation.emit(HOME, 4, 100);
    geolocation.emit(HOME, 4, 1_100);
    await settle();

    expect(store.records).toHaveLength(1);
    expect(store.records[0]?.enteredAt).toBe(100);
  });
});

describe("a host that cannot observe a position", () => {
  it("reports itself unavailable and never watches", async () => {
    const geolocation = fakeGeolocation("unsupported");
    const watch = vi.spyOn(geolocation, "watchPosition");
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation,
    });

    await capture.start();

    expect(capture.available).toBe(false);
    expect(watch).not.toHaveBeenCalled();
  });

  it("stays quiet rather than throwing, so the map still draws", async () => {
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation: fakeGeolocation("unsupported"),
    });

    await expect(capture.start()).resolves.toBeUndefined();
    expect(() => capture.stop()).not.toThrow();
  });

  it("is available on a host that may still prompt", async () => {
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation: fakeGeolocation("prompt"),
    });

    await capture.start();

    expect(capture.available).toBe(true);
  });

  it("gives up availability if the watch reports the feature missing", async () => {
    const geolocation = fakeGeolocation("prompt");
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation,
    });
    await capture.start();

    geolocation.fail("unsupported");

    expect(capture.available).toBe(false);
  });
});

describe("stopping", () => {
  it("releases the host watch", async () => {
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({
      store: recordingStore(),
      geolocation,
    });
    await capture.start();

    capture.stop();

    expect(geolocation.stopped()).toBe(1);
  });

  it("closes an open visit at the last fix actually observed", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();
    geolocation.emit(HOME, 20, 0);
    geolocation.emit(HOME, 20, DWELL_MS);

    capture.stop();
    await settle();

    expect(store.records).toHaveLength(2);
    expect(store.records[1]?.leftAt).toBe(DWELL_MS);
  });

  it("writes nothing for a dwell that never earned its cell", async () => {
    const store = recordingStore();
    const geolocation = fakeGeolocation();
    const capture = createPresenceCapture({ store, geolocation });
    await capture.start();
    geolocation.emit(HOME, 20, 0);

    capture.stop();
    await settle();

    expect(store.records).toEqual([]);
  });
});
