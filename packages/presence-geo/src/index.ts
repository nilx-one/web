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

export interface PresenceTrackerOptions {
  readonly store: PresenceStore;
  readonly resolution?: number;
  readonly accuracyGateM?: number;
  readonly dwellMs?: number;
  readonly onError?: (error: unknown) => void;
}

export function createPresenceTracker(
  options: PresenceTrackerOptions,
): PresenceTracker {
  const resolution = options.resolution ?? PRESENCE_RESOLUTION;
  const accuracyGateM = options.accuracyGateM ?? PRESENCE_ACCURACY_GATE_M;
  const dwellMs = options.dwellMs ?? PRESENCE_DWELL_MS;
  let dwell: Dwell | undefined;
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
    // Presence is derived only from observations, never from elapsed wall time.
    // One accurate fix cannot become a visit merely because no later fix
    // arrived: accepted observations in the same H3 cell must span the dwell.
    if (current.lit || current.lastFixAt - current.enteredAt < dwellMs) {
      return;
    }
    current.lit = true;
    append(record(current, null));
  }

  function close(current: Dwell): void {
    if (!current.lit) return;
    append(record(current, current.lastFixAt));
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
      if (dwell !== undefined && observation.observedAt < dwell.lastFixAt)
        return;

      const cell = latLngToCell(
        observation.latitude,
        observation.longitude,
        resolution,
      );

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
