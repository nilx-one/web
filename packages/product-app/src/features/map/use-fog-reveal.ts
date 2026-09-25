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
  FOG_APPROACH_ACCURACY_METERS,
  FOG_FRONTIER_RINGS,
  fogMarks,
  landmarksInCell,
  offerFor,
  readRevealJobs,
  revealDurationMs,
  revealFinished,
  revealRemainingMs,
  startReveal,
  writeRevealJobs,
  type FogRevealJob,
} from "./fog-reveal";

/** How often a cell being revealed repaints its progress. */
export const FOG_PROGRESS_REFRESH_MS = 2_000;

export interface FogRevealPrompt {
  readonly cell: MapFogCell;
  readonly landmarks: number;
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
}

const NO_FOG_SUBSCRIPTION = (): (() => void) => () => undefined;

/**
 * The fog around a Bond, and its Avaia working it open.
 *
 * The cells in reach are marked on the world and answer a tap with a prompt.
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

  // Whatever this field persists is this Bond's alone: bound first, before
  // anything below can read or write a reveal under it.
  useEffect(() => {
    fog?.bindOwner?.(owner);
  }, [fog, owner]);

  const [jobsState, setJobsState] = useState<{
    readonly owner: string;
    readonly jobs: readonly FogRevealJob[];
  }>(() => ({ owner, jobs: readRevealJobs(owner) }));
  // A different Bond has its own reveals; they are read, not carried over.
  // A cell whose fog lifted some other way — its Bond walked into it — is no
  // longer being worked on, whatever the stored list still says.
  const storedJobs =
    jobsState.owner === owner ? jobsState.jobs : readRevealJobs(owner);
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
        const stored =
          current.owner === owner ? current.jobs : readRevealJobs(owner);
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
    [fog, owner],
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

  // A reveal ends on the wall clock, so one that finished while the page was
  // closed lands the moment it is open again.
  useEffect(() => {
    if (fog === undefined || jobs.length === 0) return;
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
  }, [fog, jobs, updateJobs]);

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
  const livePrompt =
    prompt !== undefined && frontier.some((cell) => cell.id === prompt.cell.id)
      ? prompt
      : undefined;

  const handleFogTap = useCallback(
    (point: MapPointSelection): FogTapOutcome => {
      if (fog === undefined || !fog.isActive()) return "no-fog";
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
          setPrompt({
            cell: offer.cell,
            landmarks,
            durationMs: revealDurationMs(landmarks),
            busy: offer.kind === "busy",
          });
          return offer.kind === "busy" ? "busy" : "offered";
        }
      }
    },
    [fog, frontier, jobs, renderer],
  );

  const confirm = useCallback((): FogRevealJob | undefined => {
    if (livePrompt === undefined || livePrompt.busy) return undefined;
    const offer = offerFor(livePrompt.cell.id, frontier, jobs);
    setPrompt(undefined);
    if (offer.kind !== "offer") return undefined;
    const job = startReveal(offer.cell, livePrompt.landmarks, Date.now());
    updateJobs((current) => [...current, job]);
    return job;
  }, [frontier, jobs, livePrompt, updateJobs]);

  const dismiss = useCallback(() => setPrompt(undefined), []);

  return useMemo(
    () => ({
      active,
      frontier,
      jobs,
      prompt: livePrompt,
      handleFogTap,
      confirm,
      dismiss,
    }),
    [active, confirm, dismiss, frontier, handleFogTap, jobs, livePrompt],
  );
}

// How many times each fog field has said it changed. Kept outside React so a
// snapshot is a plain read, as useSyncExternalStore needs it to be.
const versions = new WeakMap<object, number>();
