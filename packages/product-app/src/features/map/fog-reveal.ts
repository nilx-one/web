// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapFogField,
  MapFogMark,
  MapLandmark,
} from "@nilx-one/map-contract";

/**
 * An Avaia lifting the fog off one cell at the edge of its Bond's ground.
 *
 * A Bond points at a cell it can reach into, says yes, and its Avaia goes
 * there and works the cell open. It takes a minute for bare ground and up to
 * five where the archive draws landmarks, and an Avaia works at most three
 * cells at once. What a reveal leaves behind is the fog field's own local
 * note: it is never presence evidence, never a visit, and never sent anywhere.
 */
export interface FogRevealJob {
  readonly cell: MapFogCell;
  /** Wall-clock start, so a reveal survives the page being reopened. */
  readonly startedAt: number;
  readonly durationMs: number;
  /** How many landmarks the archive drew in the cell when the reveal began. */
  readonly landmarks: number;
}

/** How many cells an Avaia works open at the same time. */
export const FOG_REVEAL_CONCURRENCY = 3;

/** Bare ground: a minute. */
export const FOG_REVEAL_MIN_MS = 60_000;

/** No cell takes longer than five minutes. */
export const FOG_REVEAL_MAX_MS = 5 * 60_000;

/** Each landmark in a cell is another minute of looking. */
export const FOG_REVEAL_PER_LANDMARK_MS = 60_000;

/** How far out, in cells, a Bond reaches into the fog from where it stands. */
export const FOG_FRONTIER_RINGS = 3;

/**
 * How far from a cell's centre the landmarks it holds are looked for. A
 * presence cell is about 175 m edge to edge; everything past that is filtered
 * by the cell itself.
 */
export const FOG_CELL_LANDMARK_RADIUS_METERS = 220;

/** An observation vaguer than this does not say which cell the device is in. */
export const FOG_APPROACH_ACCURACY_METERS = 50;

export function revealDurationMs(landmarks: number): number {
  const count = Number.isFinite(landmarks)
    ? Math.max(0, Math.floor(landmarks))
    : 0;
  return Math.min(
    FOG_REVEAL_MAX_MS,
    FOG_REVEAL_MIN_MS + count * FOG_REVEAL_PER_LANDMARK_MS,
  );
}

/** The landmarks that stand inside one cell, from what the map has loaded. */
export function landmarksInCell(
  fog: MapFogField,
  cell: MapFogCell,
  near: (
    point: MapFogCell["center"],
    radiusMeters: number,
  ) => readonly MapLandmark[],
): number {
  return near(cell.center, FOG_CELL_LANDMARK_RADIUS_METERS).filter(
    (landmark) => fog.cellAt(landmark).id === cell.id,
  ).length;
}

export function startReveal(
  cell: MapFogCell,
  landmarks: number,
  nowMs: number,
): FogRevealJob {
  return {
    cell,
    startedAt: nowMs,
    durationMs: revealDurationMs(landmarks),
    landmarks,
  };
}

export function revealProgress(job: FogRevealJob, nowMs: number): number {
  if (job.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - job.startedAt) / job.durationMs));
}

export function revealFinished(job: FogRevealJob, nowMs: number): boolean {
  return nowMs - job.startedAt >= job.durationMs;
}

export function revealRemainingMs(job: FogRevealJob, nowMs: number): number {
  return Math.max(0, job.startedAt + job.durationMs - nowMs);
}

/**
 * Why a cell can or cannot be offered right now. `busy` means the Avaia
 * already works as many cells as it can.
 */
export type FogRevealOffer =
  | { readonly kind: "offer"; readonly cell: MapFogCell }
  | { readonly kind: "revealing"; readonly job: FogRevealJob }
  | { readonly kind: "busy"; readonly cell: MapFogCell }
  | { readonly kind: "out-of-reach" };

export function offerFor(
  cellId: string,
  frontier: readonly MapFogCell[],
  jobs: readonly FogRevealJob[],
): FogRevealOffer {
  const job = jobs.find((candidate) => candidate.cell.id === cellId);
  if (job !== undefined) return { kind: "revealing", job };
  const cell = frontier.find((candidate) => candidate.id === cellId);
  if (cell === undefined) return { kind: "out-of-reach" };
  return jobs.length >= FOG_REVEAL_CONCURRENCY
    ? { kind: "busy", cell }
    : { kind: "offer", cell };
}

/** What the world marks: cells in reach, and cells being worked open. */
export function fogMarks(
  frontier: readonly MapFogCell[],
  jobs: readonly FogRevealJob[],
  nowMs: number,
): readonly MapFogMark[] {
  const working = new Set(jobs.map((job) => job.cell.id));
  return [
    ...frontier
      .filter((cell) => !working.has(cell.id))
      .map((cell) => ({ cell, state: "available" as const })),
    ...jobs.map((job) => ({
      cell: job.cell,
      state: "revealing" as const,
      progress: revealProgress(job, nowMs),
    })),
  ];
}

export interface FogRevealStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "nilx-one.fog.jobs.v1.";

function defaultStorage(): FogRevealStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isPair(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function isJob(value: unknown): value is FogRevealJob {
  if (typeof value !== "object" || value === null) return false;
  const job = value as Record<string, unknown>;
  const cell = job.cell as Record<string, unknown> | null | undefined;
  const center = cell?.center as Record<string, unknown> | null | undefined;
  return (
    typeof job.startedAt === "number" &&
    typeof job.durationMs === "number" &&
    job.durationMs >= 0 &&
    job.durationMs <= FOG_REVEAL_MAX_MS &&
    typeof job.landmarks === "number" &&
    typeof cell?.id === "string" &&
    typeof center?.longitude === "number" &&
    typeof center.latitude === "number" &&
    Array.isArray(cell.boundary) &&
    cell.boundary.every(isPair)
  );
}

/** The reveals one Bond's Avaia was working on. Never throws, never guesses. */
export function readRevealJobs(
  owner: string,
  storage: FogRevealStorage | undefined = defaultStorage(),
): readonly FogRevealJob[] {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isJob).slice(0, FOG_REVEAL_CONCURRENCY)
      : [];
  } catch {
    return [];
  }
}

export function writeRevealJobs(
  owner: string,
  jobs: readonly FogRevealJob[],
  storage: FogRevealStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify(jobs));
  } catch {
    // Best-effort: a reveal that is forgotten simply has to be asked for again.
  }
}
