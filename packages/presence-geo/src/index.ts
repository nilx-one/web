// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationObservation,
} from "@nilx-one/host-contract";
import {
  PRESENCE_ACCURACY_GATE_M,
  PRESENCE_DWELL_MS,
  PRESENCE_RESOLUTION,
  type CellIndex,
  type PresenceObservation,
  type PresenceStore,
  type PresenceTracker,
  type VisitRecord,
} from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";

interface Dwell {
  readonly cell: CellIndex;
  readonly enteredAt: number;
  lastFixAt: number;
  fixCount: number;
  bestAccuracyM: number;
  lit: boolean;
}

type IntervalHandle = ReturnType<typeof globalThis.setInterval>;

export interface PresenceTrackerOptions {
  readonly store: PresenceStore;
  readonly resolution?: number;
  readonly accuracyGateM?: number;
  readonly dwellMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
  readonly setInterval?: (listener: () => void, intervalMs: number) => IntervalHandle;
  readonly clearInterval?: (handle: IntervalHandle) => void;
}

const DWELL_TICK_MS = 5_000;

export function createPresenceTracker(options: PresenceTrackerOptions): PresenceTracker {
  const resolution = options.resolution ?? PRESENCE_RESOLUTION;
  const accuracyGateM = options.accuracyGateM ?? PRESENCE_ACCURACY_GATE_M;
  const dwellMs = options.dwellMs ?? PRESENCE_DWELL_MS;
  const now = options.now ?? (() => Date.now());
  const schedule = options.setInterval ?? globalThis.setInterval.bind(globalThis);
  const cancel = options.clearInterval ?? globalThis.clearInterval.bind(globalThis);
  let dwell: Dwell | undefined;
  let timer: IntervalHandle | undefined;
  let lastObservationKey: string | undefined;
  let writes: Promise<void> = Promise.resolve();

  function record(current: Dwell, leftAt: number | null): VisitRecord {
    return {
      cell: current.cell,
      enteredAt: current.enteredAt,
      leftAt,
      source: "self",
      fixCount: current.fixCount,
      bestAccuracyM: current.bestAccuracyM,
    };
  }

  function append(value: VisitRecord): void {
    writes = writes
      .then(() => options.store.append(value))
      .catch((error: unknown) => options.onError?.(error));
  }

  function light(current: Dwell): void {
    if (current.lit || now() - current.enteredAt < dwellMs) return;
    current.lit = true;
    append(record(current, null));
  }

  function close(current: Dwell): void {
    if (!current.lit) return;
    append(record(current, current.lastFixAt));
  }

  function ensureTimer(): void {
    if (timer !== undefined) return;
    timer = schedule(() => {
      if (dwell !== undefined) light(dwell);
    }, DWELL_TICK_MS);
  }

  return {
    observe(observation: PresenceObservation) {
      if (
        !Number.isFinite(observation.accuracyMeters) ||
        observation.accuracyMeters < 0 ||
        observation.accuracyMeters > accuracyGateM
      ) {
        return;
      }

      const key = `${observation.observedAt}:${observation.latitude}:${observation.longitude}:${observation.accuracyMeters}`;
      if (key === lastObservationKey) return;
      lastObservationKey = key;
      if (dwell !== undefined && observation.observedAt < dwell.lastFixAt) return;

      const cell = latLngToCell(
        observation.latitude,
        observation.longitude,
        resolution,
      );
      ensureTimer();

      if (dwell?.cell === cell) {
        dwell.lastFixAt = observation.observedAt;
        dwell.fixCount += 1;
        dwell.bestAccuracyM = Math.min(
          dwell.bestAccuracyM,
          observation.accuracyMeters,
        );
        light(dwell);
        return;
      }

      if (dwell !== undefined) close(dwell);
      dwell = {
        cell,
        enteredAt: observation.observedAt,
        lastFixAt: observation.observedAt,
        fixCount: 1,
        bestAccuracyM: observation.accuracyMeters,
        lit: false,
      };
      light(dwell);
    },

    stop() {
      if (timer !== undefined) {
        cancel(timer);
        timer = undefined;
      }
      if (dwell !== undefined) {
        close(dwell);
        dwell = undefined;
      }
      lastObservationKey = undefined;
    },
  };
}

function trackObservation(
  tracker: PresenceTracker,
  observation: GeolocationObservation,
): void {
  if (observation.kind === "observed") tracker.observe(observation.position);
}

/**
 * Decorates the host capability instead of creating a second GPS watcher. The
 * application keeps exactly one geolocation lifecycle; accepted observations
 * are mirrored into the local tracker before they continue unchanged.
 */
export function createPresenceGeolocation(
  capability: GeolocationCapability,
  tracker: Promise<PresenceTracker | null>,
): GeolocationCapability {
  let activeWatches = 0;

  const mirror = (observation: GeolocationObservation): void => {
    void tracker.then((value) => {
      if (value !== null) trackObservation(value, observation);
    });
  };

  return {
    readPermission: () => capability.readPermission(),

    async requestPosition(request) {
      const observation = await capability.requestPosition(request);
      mirror(observation);
      return observation;
    },

    watchPosition(observer, request) {
      activeWatches += 1;
      const unsubscribe = capability.watchPosition((observation) => {
        mirror(observation);
        observer(observation);
      }, request);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        unsubscribe();
        activeWatches = Math.max(0, activeWatches - 1);
        if (activeWatches === 0) {
          void tracker.then((value) => value?.stop());
        }
      };
    },
  };
}
