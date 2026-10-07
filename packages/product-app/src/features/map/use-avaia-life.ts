// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaLifeCommand,
  CoreGeoCoordinate,
  CoreRuntimePort,
} from "@nilx-one/application";
import type { MapPointSelection } from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

import type { AvaiaLifeSignal } from "./use-avaia-walk";

/**
 * Avaia life on this device (`docs/avaia-life.md` in core): its needs, which
 * Core keeps and moves on, fed with what this device sees of the body.
 *
 * Core owns hunger, energy and when it must go home and rest. This hook only
 * reports active time, where the body is and whether it walks, and hands
 * what Core answers on to the drive. Time the Avaia is not at the wheel, or
 * the page is closed, is never reported: nothing is simulated offline.
 */

/** How often the body is reported while the Avaia is at the wheel. */
export const LIFE_EVERY_MS = 10_000;

/** The most active time one report may carry, as Core caps it. */
const LIFE_ELAPSED_MAX_MS = 60_000;

const STORAGE_PREFIX = "nilx-one.avaia.life.v1.";

/** What the body is doing, as Avaia life reads it. */
export type LifeMotion = "idle" | "walking" | "studying";

export interface LifeBody {
  readonly point: MapPointSelection;
  readonly motion: LifeMotion;
}

/** A point as Core's wire carries it. */
export function e7(point: MapPointSelection): CoreGeoCoordinate {
  const scale = (degrees: number) => String(Math.round(degrees * 1e7) || 0);
  return {
    longitude_e7: scale(point.longitude),
    latitude_e7: scale(point.latitude),
  };
}

/** One Bond's own Avaia: whose life a stored state is. */
function lifeId(owner: string, subject: string): string {
  return `${owner}.${subject}`;
}

function readStored(id: string): string {
  try {
    return globalThis.localStorage.getItem(STORAGE_PREFIX + id) ?? "";
  } catch {
    return "";
  }
}

function writeStored(id: string, state: string): void {
  try {
    globalThis.localStorage.setItem(STORAGE_PREFIX + id, state);
  } catch {
    // Best-effort: a full or blocked store forgets, and life starts again.
  }
}

export function useAvaiaLife({
  core,
  owner,
  subject,
  active,
  body,
  home,
}: {
  readonly core: Pick<CoreRuntimePort, "applyAvaiaLife"> | undefined;
  /** The Bond's own address. */
  readonly owner: string;
  /** The Avaia's address. */
  readonly subject: string;
  /** The Avaia is at the wheel: only then does its time count. */
  readonly active: boolean;
  /** Where the body is now and what it is doing, read at each report. */
  readonly body: () => LifeBody | undefined;
  /** Home, given once when life begins; Core keeps it fixed after that. */
  readonly home: MapPointSelection | undefined;
}): AvaiaLifeSignal | undefined {
  const [signal, setSignal] = useState<AvaiaLifeSignal | undefined>(undefined);
  const latest = useRef({ body, home });
  useEffect(() => {
    latest.current = { body, home };
  });
  const apply = core?.applyAvaiaLife;

  useEffect(() => {
    if (!active || apply === undefined) return;
    const key = lifeId(owner, subject);
    let current = true;
    let busy = false;
    // Time counts from taking the wheel, never from before it.
    let last = Date.now();

    const send = async (command: AvaiaLifeCommand) => {
      const answer = await apply
        .call(core, readStored(key), owner, subject, command)
        .catch(() => undefined);
      if (!current || answer === undefined) return false;
      if (!answer.ok) {
        // A stored life Core can no longer read starts again, rather than
        // being refused on every report.
        if (answer.error === "invalid_state") writeStored(key, "");
        return false;
      }
      writeStored(key, answer.state);
      setSignal({
        intent: answer.intent,
        energy: answer.energy,
        home: answer.home,
      });
      return true;
    };

    const report = async () => {
      if (busy) return;
      busy = true;
      try {
        const at = latest.current.body();
        if (at === undefined) return;
        if (readStored(key) === "") {
          const home = latest.current.home ?? at.point;
          await send({
            op: "initialize",
            home: e7(home),
            position: e7(at.point),
          });
          last = Date.now();
          return;
        }
        const now = Date.now();
        const elapsed = Math.min(LIFE_ELAPSED_MAX_MS, Math.max(0, now - last));
        last = now;
        await send({
          op: "observe",
          elapsed_ms: String(elapsed),
          position: e7(at.point),
          motion: at.motion,
        });
      } finally {
        busy = false;
      }
    };

    void report();
    const every = globalThis.setInterval(() => void report(), LIFE_EVERY_MS);
    return () => {
      current = false;
      globalThis.clearInterval(every);
    };
  }, [active, apply, core, owner, subject]);

  return core?.applyAvaiaLife === undefined ? undefined : signal;
}
