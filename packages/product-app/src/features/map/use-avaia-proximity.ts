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

const REFRESH_MS = 2_000;
const ARTIFACT_COUNTS = [0, 1, 2, 3, 4, 5] as const;

/** Snapshot of Core's decision for a single observed Bond/Avaia distance. */
export interface AvaiaProximitySnapshot {
  readonly policy: AvaiaProximityPolicy;
  /** Core-computed duration for each artifact count, 5 being the cap. */
  readonly durationsMs: readonly (number | null)[];
}

export function useAvaiaProximity({
  core,
  owner,
  bondPoint,
  getAvaiaPoint,
}: {
  readonly core: Pick<CoreRuntimePort, "avaiaProximity"> | undefined;
  readonly owner: string;
  readonly bondPoint: MapPointSelection | undefined;
  readonly getAvaiaPoint: () => MapPointSelection | undefined;
}): AvaiaProximitySnapshot | undefined {
  const [state, setState] = useState<
    { owner: string; snapshot: AvaiaProximitySnapshot } | undefined
  >(undefined);
  const latest = useRef({ bondPoint, getAvaiaPoint });
  useEffect(() => {
    latest.current = { bondPoint, getAvaiaPoint };
  });

  const evaluate = core?.avaiaProximity;
  useEffect(() => {
    let live = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const { bondPoint, getAvaiaPoint } = latest.current;
        const avaiaPoint = getAvaiaPoint();
        if (
          bondPoint === undefined ||
          avaiaPoint === undefined ||
          evaluate === undefined
        ) {
          if (live) setState(undefined);
          return;
        }
        const meters = Math.max(
          0,
          Math.floor(mapDistanceMeters(bondPoint, avaiaPoint)),
        );
        if (!Number.isSafeInteger(meters)) {
          if (live) setState(undefined);
          return;
        }
        const values = await Promise.all(
          ARTIFACT_COUNTS.map((artifacts) =>
            evaluate.call(core, meters, artifacts),
          ),
        );
        if (!live) return;
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
          setState(undefined);
          return;
        }
        setState({
          owner,
          snapshot: {
            policy: first,
            durationsMs: values.map((p) => p.duration_ms),
          },
        });
      } catch {
        // Older Wasm artifacts, failures or stale coordinates cannot authorize work.
        if (live) setState(undefined);
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      live = false;
      globalThis.clearInterval(timer);
    };
  }, [core, evaluate, owner]);

  // A previously sampled near decision must not authorize work after either
  // body has moved, even while the next asynchronous Core read is pending.
  if (state?.owner !== owner || bondPoint === undefined) return undefined;
  const avaiaPoint = getAvaiaPoint();
  if (avaiaPoint === undefined) return undefined;
  const currentDistance = Math.max(
    0,
    Math.floor(mapDistanceMeters(bondPoint, avaiaPoint)),
  );
  const policy = state.snapshot.policy;
  // A 2s sampled distance may drift by a few metres during an ordinary walk.
  // Never reuse an authorization after crossing Core's restored-range limit.
  if (policy.can_reveal && currentDistance >= policy.restore_below_m) {
    return undefined;
  }
  return Math.abs(currentDistance - policy.distance_m) <= 8
    ? state.snapshot
    : undefined;
}
