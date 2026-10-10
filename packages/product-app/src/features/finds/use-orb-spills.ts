// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  hasOrbSpillAccess,
  MAX_CLAIM_BUCKETS,
  type CoreRuntimePort,
  type OrbSpillAccessPort,
  type OrbSpillView,
} from "@nilx-one/application";
import {
  artifactSha,
  segmentAt,
  type ArtifactId,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import type {
  MapFogCell,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { queueWorldAwards } from "../progression/committed-sync";
import {
  findsWithin,
  knownSpill,
  mapOrbs,
  orbWorldInput,
  refreshSpill,
  SPILL_READ_RADIUS_METERS,
  squareAround,
  type KnownSpill,
} from "./orb-spills";

/** How often the spills around a Bond are read again. */
export const SPILL_READ_MS = 45_000;

/** How often Core is asked again while orbs lie: who has walked into reach. */
export const ORB_REACH_CHECK_MS = 1_000;

/** A fix vaguer than this does not say a Bond stood at an orb. */
export const ORB_OBSERVATION_ACCURACY_METERS = 30;

export interface OrbSpillsInput {
  readonly owner: string;
  /** The identity service; spills need it to be one that has them. */
  readonly port: unknown;
  /** Core, which owns every orb rule. Without it no orb is drawn. */
  readonly core: Pick<CoreRuntimePort, "orbWorld"> | undefined;
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
 * Orbs on the world around a Bond. The Bond tells the service which finds
 * of a cell it opened spilled, and reads the spills around it by sha bucket.
 * Core lays them out and says who reaches what; this hook draws Core's
 * answer and turns what is in reach into a committed pick-up, which the
 * service claims first-wins.
 */
export function useOrbSpills({
  owner,
  port,
  core,
  renderer,
  near,
  bond,
  avaiaPoint,
}: OrbSpillsInput): OrbSpillsState {
  const spillPort: OrbSpillAccessPort | undefined = hasOrbSpillAccess(port)
    ? port
    : undefined;
  const orbWorld = useMemo(() => core?.orbWorld?.bind(core), [core]);
  const [spills, setSpills] = useState<ReadonlyMap<string, KnownSpill>>(
    () => new Map(),
  );
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
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
              ? knownSpill(view, roll, cellCenter, now)
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

  const pickUp = useCallback(
    (ids: readonly string[], earner: "bond" | "avaia") => {
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

  // Core is asked whenever what it knows changes, and on a short beat while
  // orbs lie, so an Avaia walking into reach is noticed. Its answer is drawn
  // as it is, and what it says is in reach is picked up.
  const latest = useRef({ spills, picked, bond, avaiaPoint });
  useEffect(() => {
    latest.current = { spills, picked, bond, avaiaPoint };
  });
  const [lying, setLying] = useState(false);
  const [nextExpiry, setNextExpiry] = useState<number | undefined>(undefined);
  const ask = useCallback(() => {
    if (orbWorld === undefined) return;
    const state = latest.current;
    const now = Date.now();
    const observed =
      state.bond !== undefined &&
      state.bond.accuracyMeters <= ORB_OBSERVATION_ACCURACY_METERS
        ? state.bond
        : undefined;
    void orbWorld(
      orbWorldInput(
        [...state.spills.values()],
        state.picked,
        observed,
        state.avaiaPoint(),
      ),
      now,
    )
      .then((view) => {
        renderer.setOrbs?.(mapOrbs(view));
        setLying(view.orbs.length > 0);
        setNextExpiry(
          view.next_expiry === null ? undefined : Number(view.next_expiry),
        );
        pickUp(view.bond_reach, "bond");
        pickUp(view.avaia_reach, "avaia");
      })
      .catch(() => undefined);
  }, [orbWorld, pickUp, renderer]);

  const bondLongitude = bond?.longitude;
  const bondLatitude = bond?.latitude;
  useEffect(() => {
    // Asked after this render, not during it: an answer may pick up orbs.
    const asked = globalThis.setTimeout(ask, 0);
    return () => globalThis.clearTimeout(asked);
  }, [ask, bondLatitude, bondLongitude, picked, spills]);

  useEffect(() => {
    if (!lying) return;
    const beat = globalThis.setInterval(ask, ORB_REACH_CHECK_MS);
    return () => globalThis.clearInterval(beat);
  }, [ask, lying]);

  // A spill is gone when Core says; the world is redrawn then.
  useEffect(() => {
    if (nextExpiry === undefined) return;
    const timer = globalThis.setTimeout(
      ask,
      Math.max(0, nextExpiry - Date.now()) + 50,
    );
    return () => globalThis.clearTimeout(timer);
  }, [ask, nextExpiry]);

  useEffect(() => () => renderer.setOrbs?.([]), [renderer]);

  return { spill };
}
