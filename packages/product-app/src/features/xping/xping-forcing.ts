// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  XpingEngineAccessPort,
  XpingEngineRead,
} from "@nilx-one/application";

import type { FlyoverForcing } from "../flyover/use-flyover";

/** Forcing that spends a full engine (core `XPING_FORCE_FULL_MS`). */
export const XPING_FORCE_FULL_MS = 30_000;
/** How much forcing is told to the service in one report. */
export const XPING_FORCE_REPORT_MS = 1_000;

export interface XpingForcing extends FlyoverForcing {
  /** What is left of the engine to force with, from 0 to 1. */
  energy(): number;
  broken(): boolean;
  subscribe(listener: () => void): () => void;
  /** Tells the service what is still untold. */
  close(): void;
}

/**
 * One flight's forcing, from the engine as the service last answered.
 * Forcing is counted here as it happens, so the control empties as it is
 * held, and told to the service a second at a time; the service runs Core's
 * rules and its answer is what counts. Two seconds on empty break the
 * engine: Core decides that on the report that crosses it, which is sent at
 * once, and `onBroken` calls the flight off.
 */
export function createXpingForcing(
  engine: XpingEngineAccessPort,
  read: XpingEngineRead,
  onBroken: () => void,
): XpingForcing {
  let energyMs = (read.view.energyPermille * XPING_FORCE_FULL_MS) / 1000;
  let marginMs = read.view.emptyMarginMs;
  let broken = read.view.broken;
  let pending = 0;
  let inFlight = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const breakDown = () => {
    if (broken) return;
    broken = true;
    energyMs = 0;
    notify();
    onBroken();
  };
  const flush = () => {
    if (inFlight || pending < 1 || broken) return;
    const told = Math.round(pending);
    pending = 0;
    inFlight = true;
    void engine
      .forceXpingEngine(told)
      .then((answer) => {
        if (answer.kind === "read") {
          // The service's engine, less what was spent since this report.
          const since = pending;
          const told =
            (answer.view.energyPermille * XPING_FORCE_FULL_MS) / 1000;
          energyMs = Math.max(0, told - since);
          marginMs = answer.view.emptyMarginMs - Math.max(0, since - told);
          if (answer.view.broken) breakDown();
          notify();
        } else if (answer.kind === "rejected" && answer.reason === "broken") {
          breakDown();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (pending >= XPING_FORCE_REPORT_MS || (marginMs <= 0 && pending > 0))
          flush();
      });
  };
  return {
    allowed: () => !broken,
    spent(ms) {
      if (broken || ms <= 0) return;
      pending += ms;
      const fromEnergy = Math.min(energyMs, ms);
      energyMs -= fromEnergy;
      marginMs -= ms - fromEnergy;
      notify();
      if (pending >= XPING_FORCE_REPORT_MS || marginMs <= 0) flush();
    },
    wear: () => 1 - Math.min(1, Math.max(0, energyMs / XPING_FORCE_FULL_MS)),
    energy: () => Math.min(1, Math.max(0, energyMs / XPING_FORCE_FULL_MS)),
    broken: () => broken,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: flush,
  };
}
