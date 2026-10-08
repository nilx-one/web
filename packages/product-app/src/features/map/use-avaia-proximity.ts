// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaProximityPolicy,
  CoreRuntimePort,
} from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import { useEffect, useRef, useState } from "react";

/** Avaia moves on her own, so the bodies are re-measured on this beat... */
export const PROXIMITY_REFRESH_MS = 2_000;
/** ...and a decision nobody renewed for this long authorizes nothing. */
export const PROXIMITY_STALE_MS = 3 * PROXIMITY_REFRESH_MS;
/**
 * Core counts at most this many artifacts (`docs/avaia-proximity.md` in
 * core: more behave as this many). Durations are quoted for each count up to
 * it, so a caller picks one by `durationFor` and never mirrors the cap.
 */
const QUOTED_ARTIFACTS = [0, 1, 2, 3, 4, 5] as const;

/** Snapshot of Core's decision for a single observed Bond/Avaia distance. */
export interface AvaiaProximitySnapshot {
  /** Core's answer for the distance, with no artifacts: the capability. */
  readonly policy: AvaiaProximityPolicy;
  /** Core's reveal duration for a cell with `artifacts`; `null` when blocked. */
  durationFor(artifacts: number): number | null;
}

export interface AvaiaProximityInput {
  readonly core: Pick<CoreRuntimePort, "avaiaProximity"> | undefined;
  readonly owner: string;
  readonly bondPoint: MapPointSelection | undefined;
  /**
   * Where the Avaia's own body is, or `undefined` when nothing says. It is
   * never defaulted to the Bond: an unknown place is not a near one.
   */
  readonly getAvaiaPoint: () => MapPointSelection | undefined;
}

/**
 * Measures the Bond and the Avaia as the independent bodies they are and asks
 * Core what that distance allows. The answer is `undefined` — nothing
 * authorized — whenever Core, a position, or a fresh sample is missing.
 *
 * Core holds no state, so this keeps the one bit it needs: whether the last
 * answer blocked reveals. It starts blocked and goes back to blocked whenever
 * the history is lost, so an unknown past never opens the restore band.
 */
export function useAvaiaProximity({
  core,
  owner,
  bondPoint,
  getAvaiaPoint,
}: AvaiaProximityInput): AvaiaProximitySnapshot | undefined {
  const [state, setState] = useState<
    { owner: string; snapshot: AvaiaProximitySnapshot } | undefined
  >(undefined);
  const latest = useRef({ bondPoint, getAvaiaPoint });
  useEffect(() => {
    latest.current = { bondPoint, getAvaiaPoint };
  });
  const sample = useRef<(() => void) | undefined>(undefined);

  const evaluate = core?.avaiaProximity;
  useEffect(() => {
    let live = true;
    let busy = false;
    let again = false;
    let previouslyBlocked = true;
    let remembered:
      { key: string; snapshot: AvaiaProximitySnapshot } | undefined;
    let expiry: ReturnType<typeof globalThis.setTimeout> | undefined;

    const forget = (): void => {
      previouslyBlocked = true;
      remembered = undefined;
      if (expiry !== undefined) globalThis.clearTimeout(expiry);
      expiry = undefined;
      if (live) setState(undefined);
    };
    const publish = (snapshot: AvaiaProximitySnapshot): void => {
      if (expiry !== undefined) globalThis.clearTimeout(expiry);
      expiry = globalThis.setTimeout(forget, PROXIMITY_STALE_MS);
      if (live) setState({ owner, snapshot });
    };

    const measure = async (): Promise<void> => {
      const { bondPoint, getAvaiaPoint } = latest.current;
      const avaiaPoint = getAvaiaPoint();
      if (
        bondPoint === undefined ||
        avaiaPoint === undefined ||
        evaluate === undefined
      ) {
        forget();
        return;
      }
      const meters = Math.max(
        0,
        Math.floor(mapDistanceMeters(bondPoint, avaiaPoint)),
      );
      if (!Number.isSafeInteger(meters)) {
        forget();
        return;
      }
      // The answer depends only on the metres and the carried bit, so a body
      // standing still is not a reason to ask Core again.
      const key = `${meters}|${previouslyBlocked}`;
      if (remembered?.key === key) {
        publish(remembered.snapshot);
        return;
      }
      try {
        const asked = previouslyBlocked;
        const values = await Promise.all(
          QUOTED_ARTIFACTS.map((artifacts) =>
            evaluate.call(core, meters, artifacts, asked),
          ),
        );
        const first = values[0];
        if (
          first === undefined ||
          values.some(
            (p) =>
              p.distance_m !== meters ||
              p.can_reveal !== first.can_reveal ||
              p.red_m !== first.red_m ||
              p.restore_below_m !== first.restore_below_m,
          )
        ) {
          forget();
          return;
        }
        const durations = values.map((p) => p.duration_ms);
        const snapshot: AvaiaProximitySnapshot = {
          policy: first,
          durationFor: (artifacts) =>
            durations[
              Math.min(
                QUOTED_ARTIFACTS.length - 1,
                Math.max(0, Math.trunc(artifacts)),
              )
            ] ?? null,
        };
        previouslyBlocked = !first.can_reveal;
        // Keyed by what was asked: the next question carries the new bit, and
        // is answered from here again only if it is the same question.
        remembered = { key: `${meters}|${asked}`, snapshot };
        publish(snapshot);
      } catch {
        // Older Wasm artifacts or a failing call cannot authorize work, and
        // the history they would have continued is gone.
        forget();
      }
    };

    const refresh = (): void => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      void (async () => {
        try {
          do {
            again = false;
            await measure();
          } while (again && live);
        } finally {
          busy = false;
        }
      })();
    };
    sample.current = refresh;

    refresh();
    const timer = globalThis.setInterval(refresh, PROXIMITY_REFRESH_MS);
    return () => {
      live = false;
      sample.current = undefined;
      globalThis.clearInterval(timer);
      if (expiry !== undefined) globalThis.clearTimeout(expiry);
    };
  }, [core, evaluate, owner]);

  // A position that arrives or changes is measured now, not on the next beat:
  // a cold start must not wait out a whole interval with nothing authorized,
  // and a fast walker must not outrun the sample.
  const bondLongitude = bondPoint?.longitude;
  const bondLatitude = bondPoint?.latitude;
  useEffect(() => {
    sample.current?.();
  }, [bondLongitude, bondLatitude]);

  return state?.owner === owner ? state.snapshot : undefined;
}
