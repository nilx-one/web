// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationFailureReason,
} from "@nilx-one/host-contract";
import {
  PRESENCE_RESOLUTION,
  type CellIndex,
  type PresenceCapture,
  type PresenceStore,
  type VisitRecord,
} from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";

/**
 * The horizontal uncertainty a fix must beat to count at all.
 *
 * A res-9 cell is a few hundred metres across, so a fix reported at 200 m could
 * comfortably belong to a neighbouring cell. Lighting a cell on that evidence
 * would mark somewhere the person was not, and a map that says you were
 * somewhere you were not is worse than a map that says nothing.
 *
 * A starting point, not a settled number: this is meant to be tuned against a
 * week of real walking.
 */
export const ACCURACY_GATE_M = 50;

/**
 * How long a person must stay in a cell before it is earned.
 *
 * Without this, a tram ride lights the whole corridor it passed through and
 * the map stops meaning anything. Presence has to outrank convenience: being
 * somewhere is standing there, not travelling over it.
 *
 * A starting point, not a settled number: also meant to be tuned from real
 * walking rather than guessed at.
 */
export const DWELL_MS = 60_000;

export interface PresenceCaptureOptions {
  readonly store: PresenceStore;
  /**
   * Device position arrives through the host capability, never through a
   * platform API reached for directly. The host is also what decides whether
   * capture is possible at all, so no surface here has to special-case a
   * Telegram WebView or a Discord iframe.
   */
  readonly geolocation: GeolocationCapability;
  readonly accuracyGateM?: number;
  readonly dwellMs?: number;
  readonly resolution?: number;
  /** Observed failures, for a surface that wants to say why nothing lights. */
  readonly onFailure?: (reason: GeolocationFailureReason) => void;
}

interface Dwell {
  readonly cell: CellIndex;
  readonly enteredAt: number;
  fixCount: number;
  bestAccuracyM: number;
  /** Whether the open record for this dwell has been written yet. */
  written: boolean;
  lastFixAt: number;
}

export interface PresenceCaptureHandle extends PresenceCapture {
  /** The cell currently being dwelled in, for a surface that wants to show it. */
  currentCell(): CellIndex | undefined;
}

export function createPresenceCapture(
  options: PresenceCaptureOptions,
): PresenceCaptureHandle {
  const accuracyGateM = options.accuracyGateM ?? ACCURACY_GATE_M;
  const dwellMs = options.dwellMs ?? DWELL_MS;
  const resolution = options.resolution ?? PRESENCE_RESOLUTION;

  let unsubscribe: (() => void) | undefined;
  let dwell: Dwell | undefined;
  let available = false;
  let running = false;
  // Appends are serialised so two fixes arriving close together cannot write a
  // closing record before the open one it closes.
  let queue: Promise<void> = Promise.resolve();

  function enqueue(record: VisitRecord): void {
    queue = queue
      .then(() => options.store.append(record))
      .catch(() => undefined);
  }

  function closeIfWritten(current: Dwell, leftAt: number): void {
    // A dwell that never earned its cell was never written, so there is
    // nothing to close: passing through leaves no trace at all.
    if (!current.written) {
      return;
    }
    enqueue({
      cell: current.cell,
      enteredAt: current.enteredAt,
      leftAt,
      source: "self",
      fixCount: current.fixCount,
      bestAccuracyM: current.bestAccuracyM,
    });
  }

  function observe(
    longitude: number,
    latitude: number,
    accuracyMeters: number,
    observedAt: number,
  ): void {
    if (!(accuracyMeters <= accuracyGateM)) {
      return;
    }

    const cell = latLngToCell(latitude, longitude, resolution);

    if (dwell === undefined || dwell.cell !== cell) {
      if (dwell !== undefined) {
        closeIfWritten(dwell, observedAt);
      }
      dwell = {
        cell,
        enteredAt: observedAt,
        fixCount: 1,
        bestAccuracyM: accuracyMeters,
        written: false,
        lastFixAt: observedAt,
      };
      return;
    }

    dwell.fixCount += 1;
    dwell.bestAccuracyM = Math.min(dwell.bestAccuracyM, accuracyMeters);
    dwell.lastFixAt = observedAt;

    if (!dwell.written && observedAt - dwell.enteredAt >= dwellMs) {
      dwell.written = true;
      // Written open, and closed by a second record on the way out: the
      // journal is append-only, so a visit is never rewritten in place.
      enqueue({
        cell: dwell.cell,
        enteredAt: dwell.enteredAt,
        leftAt: null,
        source: "self",
        fixCount: dwell.fixCount,
        bestAccuracyM: dwell.bestAccuracyM,
      });
    }
  }

  return {
    get available() {
      return available;
    },

    currentCell: () => dwell?.cell,

    async start() {
      if (running) {
        return;
      }

      const permission = await options.geolocation.readPermission();
      if (permission === "unsupported") {
        // Not an error and not a broken screen: this surface simply cannot
        // earn new cells, and shows whatever the journal already holds.
        available = false;
        return;
      }

      available = true;
      running = true;
      unsubscribe = options.geolocation.watchPosition(
        (observation) => {
          if (observation.kind === "failed") {
            if (observation.reason === "unsupported") {
              available = false;
            }
            options.onFailure?.(observation.reason);
            return;
          }
          const { position } = observation;
          observe(
            position.longitude,
            position.latitude,
            position.accuracyMeters,
            position.observedAt,
          );
        },
        { highAccuracy: true, maximumAgeMs: 0 },
      );
    },

    stop() {
      running = false;
      unsubscribe?.();
      unsubscribe = undefined;
      if (dwell !== undefined) {
        // Closed at the last fix that was actually observed, rather than at
        // the moment the page happened to go away.
        closeIfWritten(dwell, dwell.lastFixAt);
        dwell = undefined;
      }
    },
  };
}
