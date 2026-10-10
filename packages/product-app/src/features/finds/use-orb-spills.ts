// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  hasOrbSpillAccess,
  MAX_CLAIM_BUCKETS,
  type OrbSpillAccessPort,
  type OrbSpillView,
} from "@nilx-one/application";
import {
  artifactSha,
  segmentAt,
  type ArtifactId,
  type FindRoll,
  type LonLat,
  type OrbId,
} from "@nilx-one/artifact-contract";
import type {
  MapFogCell,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import { queueWorldAwards } from "../progression/committed-sync";
import {
  findsWithin,
  liveSpill,
  mapOrbs,
  orbsInReach,
  refreshSpill,
  SPILL_READ_RADIUS_METERS,
  squareAround,
  type LiveSpill,
} from "./orb-spills";

/** How often the spills around a Bond are read again. */
export const SPILL_READ_MS = 45_000;

/** How often the Avaia's place is checked against the orbs around it. */
export const ORB_REACH_CHECK_MS = 1_000;

/** A fix vaguer than this does not say a Bond stood at an orb. */
export const ORB_OBSERVATION_ACCURACY_METERS = 30;

export interface OrbSpillsInput {
  readonly owner: string;
  /** The identity service; spills need it to be one that has them. */
  readonly port: unknown;
  readonly renderer: MapRenderer;
  /** Where the Bond stands, observed or declared: spills are read around it. */
  readonly near: MapPointSelection | undefined;
  /**
   * This device's own observation while the Bond drives, and only then: a
   * declared point never picks anything up.
   */
  readonly bond:
    (MapPointSelection & { readonly accuracyMeters: number }) | undefined;
  /** Where the Avaia's body is right now, while it walks the world. */
  avaiaPoint(): MapPointSelection | undefined;
}

export interface OrbSpillsState {
  /** A cell opened: each find in it spills, and the Bond tells the service. */
  spill(cell: MapFogCell): void;
}

/**
 * Orbs on the world around a Bond: spilled by the cells it opens, read by
 * sha bucket for the finds around it, drawn on the map, and picked up by
 * whichever of the Bond and its Avaia comes within fifteen metres. A pick-up
 * is a committed award, claimed like a rare find: the committed sync says
 * whether it was kept or someone got there first.
 */
export function useOrbSpills({
  owner,
  port,
  renderer,
  near,
  bond,
  avaiaPoint,
}: OrbSpillsInput): OrbSpillsState {
  const spillPort: OrbSpillAccessPort | undefined = hasOrbSpillAccess(port)
    ? port
    : undefined;
  const [spills, setSpills] = useState<ReadonlyMap<string, LiveSpill>>(
    () => new Map(),
  );
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [clock, setClock] = useState(() => Date.now());
  const shas = useRef(new Map<ArtifactId, string>());

  const shaOf = useCallback(async (id: ArtifactId): Promise<string> => {
    const known = shas.current.get(id);
    if (known !== undefined) return known;
    const sha = await artifactSha(id);
    shas.current.set(id, sha);
    return sha;
  }, []);

  const cellCenter = useCallback(
    (point: LonLat): LonLat | undefined => {
      const fog = renderer.fog;
      if (fog === undefined) return undefined;
      const { center } = fog.cellAt({
        longitude: point[0],
        latitude: point[1],
      });
      return [center.longitude, center.latitude];
    },
    [renderer],
  );

  const adopt = useCallback(
    (entries: readonly (readonly [FindRoll, OrbSpillView])[]) => {
      if (entries.length === 0) return;
      const now = Date.now();
      setSpills((current) => {
        const next = new Map(current);
        for (const [roll, view] of entries) {
          if (view.expiresAt <= now) continue;
          const known = next.get(view.sha);
          next.set(
            view.sha,
            known === undefined
              ? liveSpill(view, roll, cellCenter, now)
              : refreshSpill(known, view),
          );
        }
        return next;
      });
    },
    [cellCenter],
  );

  const spill = useCallback(
    (cell: MapFogCell) => {
      if (spillPort === undefined) return;
      const rolls = findsWithin(cell.boundary, Date.now());
      void (async () => {
        const entries: [FindRoll, OrbSpillView][] = [];
        for (const roll of rolls) {
          const result = await spillPort
            .spillOrbs(roll.artifactId)
            .catch(() => undefined);
          if (result?.kind !== "spilled") continue;
          shas.current.set(roll.artifactId, result.spill.sha);
          entries.push([roll, result.spill]);
        }
        adopt(entries);
      })().catch(() => undefined);
    },
    [adopt, spillPort],
  );

  // The spills of the finds around the Bond, read by sha bucket on a slow
  // beat. The service hears which buckets, never which finds or where.
  const latestNear = useRef(near);
  useEffect(() => {
    latestNear.current = near;
  });
  const nearSegment =
    near === undefined ? undefined : segmentAt([near.longitude, near.latitude]);
  useEffect(() => {
    if (spillPort === undefined || nearSegment === undefined) return;
    let active = true;
    const read = async (): Promise<void> => {
      const point = latestNear.current;
      if (point === undefined) return;
      const rolls = findsWithin(
        squareAround(point, SPILL_READ_RADIUS_METERS),
        Date.now(),
      );
      if (rolls.length === 0) return;
      const bySha = new Map<string, FindRoll>();
      for (const roll of rolls) bySha.set(await shaOf(roll.artifactId), roll);
      // A sha's bucket is its first byte, as a claim's is.
      const buckets = [
        ...new Set([...bySha.keys()].map((sha) => sha.slice(0, 2))),
      ]
        .sort()
        .slice(0, MAX_CLAIM_BUCKETS);
      const result = await spillPort.readOrbSpills(buckets);
      if (!active || result.kind !== "read") return;
      const entries: [FindRoll, OrbSpillView][] = [];
      for (const view of result.spills) {
        const roll = bySha.get(view.sha);
        if (roll !== undefined) entries.push([roll, view]);
      }
      adopt(entries);
    };
    const run = (): void => void read().catch(() => undefined);
    const first = globalThis.setTimeout(run, 0);
    const beat = globalThis.setInterval(run, SPILL_READ_MS);
    return () => {
      active = false;
      globalThis.clearTimeout(first);
      globalThis.clearInterval(beat);
    };
    // The read moves with the Bond's segment, not with every fix inside it.
  }, [adopt, nearSegment, shaOf, spillPort]);

  // A spill is gone at its time; the world stops drawing it then.
  const live = [...spills.values()].filter((entry) => entry.expiresAt > clock);
  const nextExpiry = Math.min(...live.map((entry) => entry.expiresAt));
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = globalThis.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, nextExpiry - Date.now()) + 50,
    );
    return () => globalThis.clearTimeout(timer);
  }, [nextExpiry]);

  useEffect(() => {
    renderer.setOrbs?.(mapOrbs(live, picked, Date.now()));
    // `live` is derived from these; it is a new array every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, picked, renderer, spills]);
  useEffect(() => () => renderer.setOrbs?.([]), [renderer]);

  const pickUp = useCallback(
    (ids: readonly OrbId[], earner: "bond" | "avaia") => {
      if (ids.length === 0) return;
      setPicked((current) => new Set([...current, ...ids]));
      const at = Date.now();
      void queueWorldAwards(
        owner,
        ids.map((id) => ({
          record: { kind: "orb_picked_up", earner, subject: id, at },
        })),
      ).catch(() => undefined);
    },
    [owner],
  );

  // The Bond picks up what it walks to, from its own observation only.
  const bondLongitude = bond?.longitude;
  const bondLatitude = bond?.latitude;
  const bondAccuracy = bond?.accuracyMeters;
  useEffect(() => {
    if (
      bondLongitude === undefined ||
      bondLatitude === undefined ||
      bondAccuracy === undefined ||
      bondAccuracy > ORB_OBSERVATION_ACCURACY_METERS ||
      live.length === 0
    ) {
      return;
    }
    const reach = orbsInReach(
      live,
      picked,
      { longitude: bondLongitude, latitude: bondLatitude },
      Date.now(),
    );
    if (reach.length === 0) return;
    // Picked up after this render, not during it: the pick-up hides them.
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (!cancelled) pickUp(reach, "bond");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bondAccuracy, bondLatitude, bondLongitude, pickUp, picked, spills]);

  // The Avaia picks up what its body passes, checked on a short beat while
  // there is anything to pick up.
  const latestAvaia = useRef(avaiaPoint);
  useEffect(() => {
    latestAvaia.current = avaiaPoint;
  }, [avaiaPoint]);
  const anyLying = live.length > 0;
  const latestState = useRef({ live, picked });
  useEffect(() => {
    latestState.current = { live, picked };
  });
  useEffect(() => {
    if (!anyLying) return;
    const beat = globalThis.setInterval(() => {
      const point = latestAvaia.current();
      if (point === undefined) return;
      const state = latestState.current;
      pickUp(orbsInReach(state.live, state.picked, point, Date.now()), "avaia");
    }, ORB_REACH_CHECK_MS);
    return () => globalThis.clearInterval(beat);
  }, [anyLying, pickUp]);

  return { spill };
}
