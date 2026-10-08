// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  approachPoint,
  FOG_APPROACH_ACCURACY_METERS,
  FOG_FRONTIER_RINGS,
  artifactsInCell,
  fogMarks,
  freezeUnattended,
  landmarksInCell,
  offerFor,
  readAuthorizedAt,
  readRevealJobs,
  revealDurationMs,
  revealFinished,
  revealRemainingMs,
  startReveal,
  writeAuthorizedAt,
  writeRevealJobs,
  type FogRevealJob,
} from "./fog-reveal";
import type { AvaiaProximitySnapshot } from "./use-avaia-proximity";

/** How often a cell being revealed repaints its progress. */
export const FOG_PROGRESS_REFRESH_MS = 2_000;
/**
 * How often a running reveal records that Core still allows it. A page that
 * closes loses at most this much authorized time; it never gains any.
 */
export const FOG_AUTHORIZED_HEARTBEAT_MS = 5_000;

export interface FogRevealPrompt {
  readonly cell: MapFogCell;
  readonly landmarks: number;
  /** The finds lying in the cell this week: what Core prices the work by. */
  readonly artifacts: number;
  readonly durationMs: number;
  /** The Avaia already works as many cells as it can. */
  readonly busy: boolean;
}

/** What a tap on the fog turned out to be. */
export type FogTapOutcome =
  "offered" | "busy" | "revealing" | "out-of-reach" | "no-fog";

export type FogRevealVia = "avaia" | "approach";

export interface FogRevealInput {
  readonly renderer: MapRenderer;
  /**
   * Where the Bond stands — its device observation, or the point it declared
   * as its location. The cells it can reach into are measured from here.
   */
  readonly bondPoint: MapPointSelection | undefined;
  /**
   * This device's own observation, and only when it is one: a declared point
   * never walks into a cell.
   */
  readonly observed:
    (MapPointSelection & { readonly accuracyMeters: number }) | undefined;
  /** The Bond whose Avaia does the work: whose reveals these are. */
  readonly owner: string;
  /** Required in production; old isolated hook tests can omit it. */
  readonly enforceProximity?: boolean;
  readonly proximity?: AvaiaProximitySnapshot | undefined;
  readonly onRevealed?: (cell: MapFogCell, via: FogRevealVia) => void;
}

export interface FogRevealState {
  /** False when this world draws no fog, or cannot say yet what it hides. */
  readonly active: boolean;
  readonly frontier: readonly MapFogCell[];
  readonly jobs: readonly FogRevealJob[];
  readonly prompt: FogRevealPrompt | undefined;
  /** Answers a tap into the fog; `offered` opens the prompt. */
  handleFogTap(point: MapPointSelection): FogTapOutcome;
  /** The Bond said yes: the reveal starts now. */
  confirm(): FogRevealJob | undefined;
  dismiss(): void;
  /**
   * Where the Avaia stands to work `cell` open: just outside its edge, on
   * open ground, nearest `from`. It never walks into the fog it reveals.
   */
  approach(cell: MapFogCell, from?: MapPointSelection): MapPointSelection;
}

const NO_FOG_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * The fog around a Bond, and its Avaia working it open.
 *
 * The Bond is never in the fog: the cell it stands on is its own ground, so
 * the cells in reach are those that touch open ground — never the one under
 * its feet. They are marked on the world and answer a tap with a prompt.
 * A yes starts a reveal that runs on the wall clock — a minute, and up to five
 * where the archive draws landmarks — three at most at once, and it survives
 * the page being reopened. This device observing itself inside a fogged cell
 * reveals that cell at once, with no Avaia and no wait: the person is there.
 */
export function useFogReveal({
  renderer,
  bondPoint,
  observed,
  owner,
  enforceProximity = false,
  proximity,
  onRevealed,
}: FogRevealInput): FogRevealState {
  const fog = renderer.fog;
  // Anything the fog field says changed — a reveal, a journal cell lighting,
  // the journal finishing its load — is one more version of the frontier.
  const version = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (fog === undefined) return NO_FOG_SUBSCRIPTION();
        return fog.subscribe(() => {
          versions.set(fog, (versions.get(fog) ?? 0) + 1);
          listener();
        });
      },
      [fog],
    ),
    () => (fog === undefined ? 0 : (versions.get(fog) ?? 0)),
    () => 0,
  );
  const active = fog !== undefined && fog.isActive();
  const canReveal = !enforceProximity || proximity?.policy.can_reveal === true;

  // Whatever this field persists is this Bond's alone: bound first, before
  // anything below can read or write a reveal under it.
  useEffect(() => {
    fog?.bindOwner?.(owner);
  }, [fog, owner]);

  const occupiedLongitude = bondPoint?.longitude;
  const occupiedLatitude = bondPoint?.latitude;
  useEffect(() => {
    fog?.setOccupied?.(
      occupiedLongitude === undefined || occupiedLatitude === undefined
        ? undefined
        : { longitude: occupiedLongitude, latitude: occupiedLatitude },
    );
    return () => fog?.setOccupied?.(undefined);
  }, [fog, owner, occupiedLongitude, occupiedLatitude]);

  // Jobs as this page finds them. Under Core's authority a job still running
  // when the page was last seen stops where Core last allowed it, so the time
  // it was closed is never worked (`freezeUnattended`).
  const loadJobs = useCallback(
    (): readonly FogRevealJob[] =>
      enforceProximity
        ? freezeUnattended(
            readRevealJobs(owner),
            readAuthorizedAt(owner),
            Date.now(),
          )
        : readRevealJobs(owner),
    [enforceProximity, owner],
  );
  const [jobsState, setJobsState] = useState<{
    readonly owner: string;
    readonly jobs: readonly FogRevealJob[];
  }>(() => ({ owner, jobs: loadJobs() }));
  // A different Bond has its own reveals; they are read, not carried over.
  // A cell whose fog lifted some other way — its Bond walked into it — is no
  // longer being worked on, whatever the stored list still says.
  const storedJobs = jobsState.owner === owner ? jobsState.jobs : loadJobs();
  const jobs = useMemo(
    () =>
      fog === undefined || !active
        ? storedJobs
        : storedJobs.filter((job) => !fog.isRevealed(job.cell.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, fog, storedJobs, version],
  );
  const [prompt, setPrompt] = useState<FogRevealPrompt | undefined>(undefined);

  const onRevealedRef = useRef(onRevealed);
  useEffect(() => {
    onRevealedRef.current = onRevealed;
  });

  const updateJobs = useCallback(
    (change: (current: readonly FogRevealJob[]) => readonly FogRevealJob[]) => {
      setJobsState((current) => {
        const stored = current.owner === owner ? current.jobs : loadJobs();
        const base =
          fog === undefined || !fog.isActive()
            ? stored
            : stored.filter((job) => !fog.isRevealed(job.cell.id));
        const next = change(base);
        if (next === base && current.owner === owner) return current;
        writeRevealJobs(owner, next);
        return { owner, jobs: next };
      });
    },
    [fog, loadJobs, owner],
  );

  const bondCell =
    fog === undefined || bondPoint === undefined
      ? undefined
      : fog.cellAt(bondPoint).id;
  const bondLongitude = bondPoint?.longitude;
  const bondLatitude = bondPoint?.latitude;
  const frontier = useMemo(() => {
    if (
      fog === undefined ||
      !active ||
      bondCell === undefined ||
      bondLongitude === undefined ||
      bondLatitude === undefined
    ) {
      return [];
    }
    return fog.frontier(
      { longitude: bondLongitude, latitude: bondLatitude },
      FOG_FRONTIER_RINGS,
    );
    // The frontier moves with the Bond's cell, not with every metre inside it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, bondCell, fog, version]);

  // The world marks what is in reach and what is being worked open. Progress
  // repaints on a slow beat, because a reveal takes minutes, not frames.
  useEffect(() => {
    const setMarks = renderer.setFogMarks;
    if (setMarks === undefined) return;
    const paint = (): void =>
      setMarks.call(
        renderer,
        active ? fogMarks(frontier, jobs, Date.now()) : [],
      );
    paint();
    const beat =
      jobs.length === 0
        ? undefined
        : globalThis.setInterval(paint, FOG_PROGRESS_REFRESH_MS);
    return () => {
      if (beat !== undefined) globalThis.clearInterval(beat);
    };
  }, [active, frontier, jobs, renderer]);

  useEffect(() => () => renderer.setFogMarks?.([]), [renderer]);

  // While Core allows running work, say so now and on a beat: this is the
  // only evidence a reopened page has that the time before it was authorized.
  const running =
    enforceProximity && jobs.some((job) => job.pausedAt === undefined);
  useEffect(() => {
    if (!running || !canReveal) return;
    writeAuthorizedAt(owner, Date.now());
    const beat = globalThis.setInterval(
      () => writeAuthorizedAt(owner, Date.now()),
      FOG_AUTHORIZED_HEARTBEAT_MS,
    );
    return () => globalThis.clearInterval(beat);
  }, [canReveal, owner, running]);

  // A disabled Core capability freezes running work; resuming shifts the
  // start so blocked wall-clock time never counts toward completed work.
  // Persist from an asynchronous effect callback to avoid render cascades.
  useEffect(() => {
    if (!enforceProximity || jobs.length === 0) return;
    const needsPause =
      !canReveal && jobs.some((job) => job.pausedAt === undefined);
    const needsResume =
      canReveal && jobs.some((job) => job.pausedAt !== undefined);
    if (!needsPause && !needsResume) return;
    const now = Date.now();
    let cancelled = false;
    globalThis.queueMicrotask(() => {
      if (cancelled) return;
      updateJobs((current) =>
        current.map((job) => {
          if (needsPause && job.pausedAt === undefined) {
            return { ...job, pausedAt: now };
          }
          if (needsResume && job.pausedAt !== undefined) {
            return {
              ...job,
              startedAt: job.startedAt + now - job.pausedAt,
              pausedAt: undefined,
            };
          }
          return job;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enforceProximity, canReveal, jobs, updateJobs]);

  // A reveal ends on the wall clock, so one that finished while the page was
  // closed lands the moment it is open again.
  useEffect(() => {
    if (fog === undefined || jobs.length === 0 || !canReveal) return;
    const finish = (): void => {
      const now = Date.now();
      const done = jobs.filter((job) => revealFinished(job, now));
      if (done.length === 0) return;
      for (const job of done) fog.reveal(job.cell.id);
      updateJobs((current) =>
        current.filter((job) => !revealFinished(job, now)),
      );
      for (const job of done) onRevealedRef.current?.(job.cell, "avaia");
    };
    const next = Math.min(
      ...jobs.map((job) => revealRemainingMs(job, Date.now())),
    );
    const timer = globalThis.setTimeout(finish, next);
    return () => globalThis.clearTimeout(timer);
  }, [canReveal, fog, jobs, updateJobs]);

  // Standing in a fogged cell reveals it: no Avaia, no wait, one cell.
  const observedLongitude = observed?.longitude;
  const observedLatitude = observed?.latitude;
  const observedAccuracy = observed?.accuracyMeters;
  useEffect(() => {
    if (
      fog === undefined ||
      !active ||
      observedLongitude === undefined ||
      observedLatitude === undefined ||
      observedAccuracy === undefined ||
      observedAccuracy > FOG_APPROACH_ACCURACY_METERS
    ) {
      return;
    }
    const cell = fog.cellAt({
      longitude: observedLongitude,
      latitude: observedLatitude,
    });
    if (fog.isRevealed(cell.id)) return;
    // The fog field tells its subscribers, which is what drops this cell from
    // the frontier, from the prompt, and from any reveal working on it.
    fog.reveal(cell.id);
    onRevealedRef.current?.(cell, "approach");
  }, [active, fog, observedAccuracy, observedLatitude, observedLongitude]);

  // A prompt for a cell that left reach — the Bond moved, or the fog lifted
  // there some other way — is no longer a question anyone can answer.
  //
  // Under Core's authority the duration shown, and started on a yes, is Core's
  // quote *now*: Avaia can walk while the question is open, and the minute
  // quoted beside her is not the quarter hour at the far end of the town. A
  // quote that is gone closes the question rather than starting on the old one.
  const quotedMs =
    prompt === undefined
      ? undefined
      : enforceProximity
        ? (proximity?.durationFor(prompt.artifacts) ?? null)
        : prompt.durationMs;
  const livePrompt = useMemo(
    () =>
      canReveal &&
      prompt !== undefined &&
      quotedMs !== null &&
      quotedMs !== undefined &&
      frontier.some((cell) => cell.id === prompt.cell.id)
        ? prompt.durationMs === quotedMs
          ? prompt
          : { ...prompt, durationMs: quotedMs }
        : undefined,
    [canReveal, frontier, prompt, quotedMs],
  );

  const handleFogTap = useCallback(
    (point: MapPointSelection): FogTapOutcome => {
      if (fog === undefined || !fog.isActive()) return "no-fog";
      if (!canReveal) return "out-of-reach";
      const cell = fog.cellAt(point);
      const offer = offerFor(cell.id, frontier, jobs);
      switch (offer.kind) {
        case "out-of-reach":
          return "out-of-reach";
        case "revealing":
          return "revealing";
        case "busy":
        case "offer": {
          const landmarks = landmarksInCell(
            fog,
            offer.cell,
            (at, radius) => renderer.landmarksNear?.(at, radius) ?? [],
          );
          // Core prices the work by the artifacts lying in the cell, counted
          // by the public roll; landmarks only colour the story and the
          // isolated-test fallback below.
          const artifacts = artifactsInCell(offer.cell, Date.now());
          const coreDuration = proximity?.durationFor(artifacts) ?? null;
          if (enforceProximity && coreDuration === null) return "out-of-reach";
          setPrompt({
            cell: offer.cell,
            landmarks,
            artifacts,
            // Core's duration is the only one under enforcement; the Web table
            // is for isolated tests that run without a Core.
            durationMs: coreDuration ?? revealDurationMs(landmarks),
            busy: offer.kind === "busy",
          });
          return offer.kind === "busy" ? "busy" : "offered";
        }
      }
    },
    [canReveal, enforceProximity, fog, frontier, jobs, proximity, renderer],
  );

  const confirm = useCallback((): FogRevealJob | undefined => {
    if (!canReveal || livePrompt === undefined || livePrompt.busy) {
      return undefined;
    }
    const offer = offerFor(livePrompt.cell.id, frontier, jobs);
    setPrompt(undefined);
    if (offer.kind !== "offer") return undefined;
    const job = startReveal(
      offer.cell,
      livePrompt.landmarks,
      Date.now(),
      livePrompt.durationMs,
    );
    updateJobs((current) => [...current, job]);
    return job;
  }, [canReveal, frontier, jobs, livePrompt, updateJobs]);

  const dismiss = useCallback(() => setPrompt(undefined), []);

  const approach = useCallback(
    (cell: MapFogCell, from?: MapPointSelection): MapPointSelection =>
      approachPoint(
        cell,
        (point) => {
          if (fog === undefined) return false;
          const id = fog.cellAt(point).id;
          return id !== cell.id && (id === bondCell || fog.isRevealed(id));
        },
        from ?? bondPoint,
      ),
    [bondCell, bondPoint, fog],
  );

  return useMemo(
    () => ({
      active,
      frontier,
      jobs,
      prompt: livePrompt,
      handleFogTap,
      confirm,
      dismiss,
      approach,
    }),
    [
      active,
      approach,
      confirm,
      dismiss,
      frontier,
      handleFogTap,
      jobs,
      livePrompt,
    ],
  );
}

// How many times each fog field has said it changed. Kept outside React so a
// snapshot is a plain read, as useSyncExternalStore needs it to be.
const versions = new WeakMap<object, number>();
