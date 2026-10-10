// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Whether xSasha's introduction still has to be played for a Bond.
 *
 * Two answers are kept on this device: the scene was played through, or a
 * person skipped it. "Later" is kept for this session only — she comes back
 * the next time the world opens. None of it is sent anywhere, and none of it
 * is a fact about the Bond: it is a play record, transport-eligible like the
 * rest of them.
 */
export type GuideIntroMemory = "skipped" | "done";

/**
 * Her word on new ground, kept in the same record: owed once the Bond opened
 * its first cell beyond the one it started on, and said only once its Avaia
 * exists — a Bond that skipped creating one hears it the moment it does.
 */
export type GuideTerritoryMemory = "opened" | "done";

export interface GuideMemoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "nilx-one.guide.v1.";

const postponed = new Set<string>();

function defaultStorage(): GuideMemoryStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

interface GuideRecord {
  readonly intro?: GuideIntroMemory;
  readonly territory?: GuideTerritoryMemory;
}

function readRecord(
  owner: string,
  storage: GuideMemoryStorage | undefined,
): GuideRecord {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const { intro, territory } = parsed as Record<string, unknown>;
    return {
      ...(intro === "skipped" || intro === "done" ? { intro } : {}),
      ...(territory === "opened" || territory === "done" ? { territory } : {}),
    };
  } catch {
    return {};
  }
}

function writeRecord(
  owner: string,
  change: Partial<GuideRecord>,
  storage: GuideMemoryStorage | undefined,
): void {
  try {
    storage?.setItem(
      STORAGE_PREFIX + owner,
      JSON.stringify({ ...readRecord(owner, storage), ...change }),
    );
  } catch {
    // Storage is optional: she simply says it again next time.
  }
}

export function readGuideIntro(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): GuideIntroMemory | undefined {
  return readRecord(owner, storage).intro;
}

export function rememberGuideIntro(
  owner: string,
  intro: GuideIntroMemory,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): void {
  writeRecord(owner, { intro }, storage);
}

export function postponeGuideIntro(owner: string): void {
  postponed.add(owner);
}

/** Whether the introduction is still owed to this Bond, right now. */
export function guideIntroOwed(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): boolean {
  return !postponed.has(owner) && readGuideIntro(owner, storage) === undefined;
}

/** Forgets what this session postponed. For tests. */
export function forgetGuideSession(): void {
  postponed.clear();
}

/** A cell beyond the starting one was opened: the scene is owed, once. */
export function rememberFirstCellOpened(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): void {
  if (readRecord(owner, storage).territory !== undefined) return;
  writeRecord(owner, { territory: "opened" }, storage);
}

export function rememberGuideTerritory(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): void {
  writeRecord(owner, { territory: "done" }, storage);
}

export function guideTerritoryOwed(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): boolean {
  return readRecord(owner, storage).territory === "opened";
}
