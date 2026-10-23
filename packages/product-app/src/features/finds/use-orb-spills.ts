// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  hasCellSpillAccess,
  hasOrbSpillAccess,
  MAX_CLAIM_BUCKETS,
  type CellSpillAccessPort,
  type CoreRuntimePort,
  type OrbSpillAccessPort,
  type OrbSpillView,
  type OrbWorldOrb,
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
  MapOrb,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cellOrbSubject } from "../progression/commitment";
import {
  queueWorldAwards,
  type QueueWorldAward,
} from "../progression/committed-sync";
import {
  answerCell,
  cellOfOrb,
  findsWithin,
  knownCell,
  knownSpill,
  landmarkWaypoint,
  mapOrbs,
  orbWorldInput,
  refreshSpill,
  openCell,
  pickCellOrbs,
  rarityTier,
  readCellOrbStore,
  settleCells,
  SPILL_READ_RADIUS_METERS,
  squareAround,
  writeCellOrbStore,
  type CellOrbStore,
  type KnownCell,
  type KnownSpill,
} from "./orb-spills";

/** How often the spills around a Bond are read again. */
export const SPILL_READ_MS = 45_000;

/** How often Core is asked again while orbs lie: who has walked into reach. */
export const ORB_REACH_CHECK_MS = 1_000;

/** A fix vaguer than this does not say a Bond stood at an orb. */
export const ORB_OBSERVATION_ACCURACY_METERS = 30;

/**
 * How long a picked-up orb stays in the list the renderer draws: its hop,
 * its flight to whoever picked it up and the flash where it arrives, plus
 * the latest start of a staggered pick-up.
 */
export const ORB_PULL_DRAW_MS = 1_400;

/** Orbs picked up together leave one after another, this far apart. */
export const ORB_PULL_STAGGER_MS = 60;

/** The stagger stops growing after this many orbs, so none waits long. */
const ORB_PULL_STAGGER_MAX = 6;

/** How often a cell whose spill is still owed is asked for again. */
export const CELL_SPILL_RETRY_MS = 60_000;

/** At most this many owed cell spills are asked for at once. */
export const CELL_SPILL_RETRY_BATCH = 20;

export interface OrbSpillsInput {
  readonly owner: string;
  /** The identity service; spills need it to be one that has them. */
  readonly port: unknown;
  /** Core, which owns every orb rule. Without it no orb is drawn. */
  readonly core:
    Pick<CoreRuntimePort, "orbWorld" | "orbSpillVersion"> | undefined;
  readonly renderer: MapRenderer;
  /** Where the Bond stands, observed or declared: spills are read around it. */
  readonly near: MapPointSelection | undefined;
  /**
   * The driving Bond's gameplay position: observed GPS or a manually declared
   * virtual position. Manual placement is not evidence of physical presence.
   */
  readonly bond:
    | (MapPointSelection & {
        readonly accuracyMeters: number;
        readonly declared?: boolean;
      })
    | undefined;
  /** Where the Avaia's body is right now, while it walks the world. */
  avaiaPoint(): MapPointSelection | undefined;
  /**
   * Orbs were just picked up: the host's sound and a light haptic tap, once
   * for however many came in together.
   */
  onPickedUp?(): void;
}

export interface OrbSpillsState {
  /**
   * A cell opened: it spills its own orbs (Core v4, `docs/exp-orbs.md`), each
   * find in it spills too, and the Bond tells the service.
   */
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
  onPickedUp,
}: OrbSpillsInput): OrbSpillsState {
  const spillPort: OrbSpillAccessPort | undefined = hasOrbSpillAccess(port)
    ? port
    : undefined;
  const cellPort: CellSpillAccessPort | undefined = hasCellSpillAccess(port)
    ? port
    : undefined;
  const orbWorld = useMemo(() => core?.orbWorld?.bind(core), [core]);
  // Capability is read from the actual verified runtime, never assumed from
  // the Web bundle's version. Older Core rejects unknown `via` fields.
  const [capability, setCapability] = useState<{
    readonly runtime: OrbSpillsInput["core"];
    readonly version: number;
  }>({ runtime: undefined, version: 1 });
  useEffect(() => {
    let live = true;
    void core
      ?.orbSpillVersion?.()
      .then((version) => {
        if (live && Number.isInteger(version) && version >= 1) {
          setCapability({ runtime: core, version });
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [core]);
  const waypointsEnabled =
    capability.runtime === core && capability.version >= 2;
  // A cell spills its own orbs only into a runtime that lays them (v4+).
  const cellsEnabled = capability.runtime === core && capability.version >= 4;
  const [spills, setSpills] = useState<ReadonlyMap<string, KnownSpill>>(
    () => new Map(),
  );
  // What this device kept of its opened cells (`CellOrbStore`): a cell's
  // orbs lie until picked up, and a spill still owed is asked for again.
  const [store, setStore] = useState<CellOrbStore>(() =>
    readCellOrbStore(owner),
  );
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
    // A refused write keeps everything in memory; the next change retries.
    writeCellOrbStore(owner, store);
  }, [owner, store]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(store.picked),
  );
  const inFlightCellSpills = useRef(new Set<string>());
  const requestCellSpill = useCallback(
    (cellId: string) => {
      if (
        !cellsEnabled ||
        cellPort === undefined ||
        inFlightCellSpills.current.has(cellId) ||
        storeRef.current.cells.has(cellId) ||
        storeRef.current.done.has(cellId)
      ) {
        return;
      }
      inFlightCellSpills.current.add(cellId);
      void cellPort
        .spillCell(cellId)
        .then((result) => {
          // Unanswered, it stays owed and is asked for again.
          if (result.kind !== "spilled") return;
          setStore((current) =>
            answerCell(current, knownCell(cellId, result.spill, Date.now())),
          );
        })
        .catch(() => undefined)
        .finally(() => inFlightCellSpills.current.delete(cellId));
    },
    [cellPort, cellsEnabled],
  );
  // Owed spills: asked for as soon as a v4 runtime is known (a reveal can
  // come before the handshake, or before a reload), then on a slow beat.
  useEffect(() => {
    if (!cellsEnabled || cellPort === undefined) return;
    const retry = (): void => {
      for (const id of [...storeRef.current.pending].slice(
        0,
        CELL_SPILL_RETRY_BATCH,
      )) {
        requestCellSpill(id);
      }
    };
    retry();
    const beat = globalThis.setInterval(retry, CELL_SPILL_RETRY_MS);
    return () => globalThis.clearInterval(beat);
  }, [cellPort, cellsEnabled, requestCellSpill]);
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

  const waypoint = useCallback(
    (roll: FindRoll): LonLat | undefined => {
      const near = renderer.landmarksNear?.bind(renderer);
      return landmarkWaypoint(roll, renderer.fog, near);
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
              ? knownSpill(view, roll, cellCenter, now, waypoint(roll))
              : refreshSpill(known, view),
          );
        }
        return next;
      });
    },
    [cellCenter, waypoint],
  );

  const spill = useCallback(
    (cell: MapFogCell) => {
      // The cell's own orbs: the service answers its spill, and keeps
      // nothing. A cell spills once; one already kept is not asked again.
      if (cellPort !== undefined) {
        const owed = openCell(storeRef.current, cell.id);
        if (owed !== storeRef.current) {
          storeRef.current = owed;
          setStore(owed);
        }
        requestCellSpill(cell.id);
      }
      if (spillPort === undefined) return;
      void (async () => {
        // Read the real POIs in this opened cell before choosing waypoints.
        // A failed or missing archive is not a reason to suppress the orbs.
        const longitudes = cell.boundary.map(([lng]) => lng);
        const latitudes = cell.boundary.map(([, lat]) => lat);
        if (
          longitudes.length >= 3 &&
          Math.max(...longitudes) - Math.min(...longitudes) < 1
        ) {
          try {
            await renderer.preloadLandmarks?.({
              west: Math.min(...longitudes),
              east: Math.max(...longitudes),
              south: Math.min(...latitudes),
              north: Math.max(...latitudes),
            });
          } catch {
            // Preserve the legacy direct trail when offline.
          }
        }
        const rolls = findsWithin(cell.boundary, Date.now());
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
    [adopt, cellPort, renderer, requestCellSpill, spillPort],
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

  // Picked-up orbs, drawn flying to whoever picked them up for a moment.
  const pulls = useRef(new Map<string, MapOrb>());
  // What was picked up, at once: two answers of Core in flight together
  // must not pick up the same orb twice.
  const pickedNow = useRef(new Set(store.picked));
  const pickUp = useCallback(
    (
      ids: readonly string[],
      earner: "bond" | "avaia",
      orbs: ReadonlyMap<string, OrbWorldOrb>,
      to: MapPointSelection | undefined,
      known: ReadonlyMap<string, KnownCell>,
    ): number => {
      const fresh = ids.filter((id) => !pickedNow.current.has(id));
      if (fresh.length === 0) return 0;
      const at = Date.now();
      const records: QueueWorldAward[] = [];
      for (const id of fresh) {
        if (!id.startsWith("orb:cell:")) {
          records.push({
            record: { kind: "orb_picked_up", earner, subject: id, at },
          });
          continue;
        }
        const cell = cellOfOrb(known.values(), id);
        if (cell === undefined) continue;
        records.push({
          record: {
            kind: "cell_orb_picked_up",
            earner,
            subject: cellOrbSubject(id, cell.cell),
            // Its rarity, for showing what it pays; the service prices it.
            tier: rarityTier(orbs.get(id)?.rarity),
            at,
          },
        });
      }
      if (records.length === 0) return 0;
      for (const id of fresh) pickedNow.current.add(id);
      setPicked((current) => new Set([...current, ...fresh]));
      setStore((current) => pickCellOrbs(current, fresh));
      if (to !== undefined) {
        let order = 0;
        for (const id of fresh) {
          const orb = orbs.get(id);
          if (orb === undefined) continue;
          const leaves =
            at + Math.min(order, ORB_PULL_STAGGER_MAX) * ORB_PULL_STAGGER_MS;
          order += 1;
          const [drawn] = mapOrbs({
            orbs: [orb],
            bond_reach: [],
            avaia_reach: [],
            next_expiry: null,
          });
          if (drawn === undefined) continue;
          pulls.current.set(id, {
            ...drawn,
            landsAt: Math.min(drawn.landsAt, at),
            pulledTo: {
              longitude: to.longitude,
              latitude: to.latitude,
              at: leaves,
            },
          });
        }
      }
      void queueWorldAwards(owner, records).catch(() => undefined);
      return records.length;
    },
    [owner],
  );

  // Core is asked whenever what it knows changes, and on a short beat while
  // orbs lie, so an Avaia walking into reach is noticed. Its answer is drawn
  // as it is, and what it says is in reach is picked up.
  const cells = store.cells;
  const latest = useRef({
    spills,
    cells,
    picked,
    bond,
    avaiaPoint,
    onPickedUp,
  });
  useEffect(() => {
    latest.current = { spills, cells, picked, bond, avaiaPoint, onPickedUp };
  });
  const worldRequest = useRef(0);
  const [lying, setLying] = useState(false);
  const [nextExpiry, setNextExpiry] = useState<number | undefined>(undefined);
  const ask = useCallback(() => {
    if (orbWorld === undefined) return;
    const state = latest.current;
    const request = ++worldRequest.current;
    const now = Date.now();
    // A declared point is a virtual game position, not an inaccurate GPS fix.
    // Only actual observations must meet the accuracy threshold.
    const bondPoint =
      state.bond !== undefined &&
      (state.bond.declared === true ||
        state.bond.accuracyMeters <= ORB_OBSERVATION_ACCURACY_METERS)
        ? state.bond
        : undefined;
    const avaiaPoint = state.avaiaPoint();
    // Only the cells this answer is asked about may be judged by it.
    const asked = cellsEnabled ? [...state.cells.values()] : [];
    void orbWorld(
      orbWorldInput(
        [...state.spills.values()],
        state.picked,
        bondPoint,
        avaiaPoint,
        waypointsEnabled,
        asked,
      ),
      now,
    )
      .then((view) => {
        if (request !== worldRequest.current) return;
        const orbs = new Map(view.orbs.map((orb) => [orb.id, orb]));
        const picked =
          pickUp(view.bond_reach, "bond", orbs, bondPoint, state.cells) +
          pickUp(view.avaia_reach, "avaia", orbs, avaiaPoint, state.cells);
        if (picked > 0) state.onPickedUp?.();
        const drawnAt = Date.now();
        for (const [id, orb] of pulls.current) {
          if ((orb.pulledTo?.at ?? 0) + ORB_PULL_DRAW_MS < drawnAt) {
            pulls.current.delete(id);
          }
        }
        const lying = mapOrbs(view).filter((orb) => !pulls.current.has(orb.id));
        renderer.setOrbs?.([...lying, ...pulls.current.values()]);
        // A cell with nothing left lying, its last orbs just picked up
        // included, is done: it is never asked for or drawn again.
        if (asked.length > 0) {
          const lyingCells = new Set(
            view.orbs
              .filter(
                (orb) =>
                  orb.id.startsWith("orb:cell:") &&
                  !pickedNow.current.has(orb.id),
              )
              .map((orb) => orb.id),
          );
          setStore((current) =>
            settleCells(
              current,
              asked.map((cell) => cell.cell),
              lyingCells,
            ),
          );
        }
        setLying(view.orbs.length > 0 || pulls.current.size > 0);
        setNextExpiry(
          view.next_expiry === null ? undefined : Number(view.next_expiry),
        );
      })
      .catch(() => undefined);
  }, [cellsEnabled, orbWorld, pickUp, renderer, waypointsEnabled]);

  const bondLongitude = bond?.longitude;
  const bondLatitude = bond?.latitude;
  useEffect(() => {
    // Asked after this render, not during it: an answer may pick up orbs.
    const asked = globalThis.setTimeout(ask, 0);
    return () => globalThis.clearTimeout(asked);
  }, [ask, bondLatitude, bondLongitude, cells, picked, spills]);

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
