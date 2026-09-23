// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * What this device remembers about the landmarks around a Bond.
 *
 * A person walking past a monument is what puts it here: the device observed
 * itself close to something the basemap draws, and that is the whole of the
 * evidence. Its Avaia later walks up to what was noticed and studies it, which
 * is the second half. Both halves are this device's own and nothing else's:
 * the notebook is never synced, exported, sent anywhere, or used as training
 * signal, and it asserts nothing about presence, attendance, or any Bond.
 */
export interface NoticedLandmark {
  readonly landmark: MapLandmark;
  readonly noticedAt: number;
}

export interface StudiedLandmark {
  readonly landmark: MapLandmark;
  readonly studiedAt: number;
  /** The Avaia address that studied it. */
  readonly by: string;
}

export interface LandmarkNotebook {
  readonly noticed: readonly NoticedLandmark[];
  readonly studied: readonly StudiedLandmark[];
}

export const EMPTY_NOTEBOOK: LandmarkNotebook = { noticed: [], studied: [] };

const STORAGE_PREFIX = "nilx-one.avaia.landmarks.v1.";

/** Enough for a city's worth of walks, small enough to stay a note. */
export const NOTEBOOK_LIMIT = 200;

/** How close a person has to pass for a landmark to count as noticed. */
export const NOTICE_RADIUS_METERS = 40;

/** An observation vaguer than this is a neighbourhood, not a passing glance. */
export const NOTICE_ACCURACY_METERS = 50;

/** How far an Avaia will go on its own to study something. */
export const CURIOSITY_REACH_METERS = 3_000;

export interface NotebookStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): NotebookStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isLandmark(value: unknown): value is MapLandmark {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.longitude === "number" &&
    typeof candidate.latitude === "number" &&
    typeof candidate.facts === "object" &&
    candidate.facts !== null
  );
}

/** What this device remembers for one Bond. Never throws, never guesses. */
export function readNotebook(
  owner: string,
  storage: NotebookStorage | undefined = defaultStorage(),
): LandmarkNotebook {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return EMPTY_NOTEBOOK;
    const parsed = JSON.parse(raw) as {
      noticed?: unknown;
      studied?: unknown;
    };
    const noticed = Array.isArray(parsed.noticed)
      ? parsed.noticed.filter(
          (entry: { landmark?: unknown; noticedAt?: unknown }) =>
            isLandmark(entry?.landmark) && typeof entry.noticedAt === "number",
        )
      : [];
    const studied = Array.isArray(parsed.studied)
      ? parsed.studied.filter(
          (entry: { landmark?: unknown; studiedAt?: unknown; by?: unknown }) =>
            isLandmark(entry?.landmark) &&
            typeof entry.studiedAt === "number" &&
            typeof entry.by === "string",
        )
      : [];
    return { noticed, studied } as LandmarkNotebook;
  } catch {
    return EMPTY_NOTEBOOK;
  }
}

export function writeNotebook(
  owner: string,
  notebook: LandmarkNotebook,
  storage: NotebookStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify(notebook));
  } catch {
    // Remembering is best-effort: a full or blocked store forgets, it never breaks the world.
  }
}

/** Adds what was just passed, keeping the first time each was seen. */
export function noticeLandmarks(
  notebook: LandmarkNotebook,
  landmarks: readonly MapLandmark[],
  nowMs: number,
): LandmarkNotebook {
  const known = new Set(notebook.noticed.map((entry) => entry.landmark.id));
  const added = landmarks
    .filter((landmark) => !known.has(landmark.id))
    .map((landmark) => ({ landmark, noticedAt: nowMs }));
  if (added.length === 0) return notebook;
  return {
    ...notebook,
    noticed: [...notebook.noticed, ...added].slice(-NOTEBOOK_LIMIT),
  };
}

export function studyLandmark(
  notebook: LandmarkNotebook,
  landmark: MapLandmark,
  by: string,
  nowMs: number,
): LandmarkNotebook {
  const studied = notebook.studied.filter(
    (entry) => !(entry.landmark.id === landmark.id && entry.by === by),
  );
  return {
    ...notebook,
    studied: [...studied, { landmark, studiedAt: nowMs, by }].slice(
      -NOTEBOOK_LIMIT,
    ),
  };
}

/**
 * The nearest thing the person noticed that this Avaia has not studied yet,
 * within reach. The Avaia chooses only among what the person already found:
 * it never goes looking past what its owner walked by.
 */
export function nextLandmarkToStudy(
  notebook: LandmarkNotebook,
  by: string,
  from: MapPointSelection,
  reachMeters = CURIOSITY_REACH_METERS,
): MapLandmark | undefined {
  const done = new Set(
    notebook.studied
      .filter((entry) => entry.by === by)
      .map((entry) => entry.landmark.id),
  );
  let best: { landmark: MapLandmark; distance: number } | undefined;
  for (const { landmark } of notebook.noticed) {
    if (done.has(landmark.id)) continue;
    const distance = mapDistanceMeters(from, landmark);
    if (distance > reachMeters) continue;
    if (best === undefined || distance < best.distance) {
      best = { landmark, distance };
    }
  }
  return best?.landmark;
}

/** What one Avaia has studied, most recent first. */
export function studiedBy(
  notebook: LandmarkNotebook,
  by: string,
): readonly StudiedLandmark[] {
  return notebook.studied
    .filter((entry) => entry.by === by)
    .toSorted((a, b) => b.studiedAt - a.studiedAt);
}

// One notebook per Bond for the whole page, read from storage once. It is an
// external store rather than component state because what fills it — a
// passing observation — is not a render: nothing that notices a landmark
// should have to schedule one.
const notebooks = new Map<string, LandmarkNotebook>();
const notebookListeners = new Set<() => void>();

export function notebookSnapshot(owner: string): LandmarkNotebook {
  const cached = notebooks.get(owner);
  if (cached !== undefined) return cached;
  const read = readNotebook(owner);
  notebooks.set(owner, read);
  return read;
}

export function updateNotebook(
  owner: string,
  change: (notebook: LandmarkNotebook) => LandmarkNotebook,
): void {
  const current = notebookSnapshot(owner);
  const next = change(current);
  if (next === current) return;
  notebooks.set(owner, next);
  writeNotebook(owner, next);
  for (const listener of [...notebookListeners]) listener();
}

export function subscribeNotebooks(listener: () => void): () => void {
  notebookListeners.add(listener);
  return () => notebookListeners.delete(listener);
}

/** Forgets what was read, so the next snapshot reads storage again. */
export function forgetNotebookCache(): void {
  notebooks.clear();
}
