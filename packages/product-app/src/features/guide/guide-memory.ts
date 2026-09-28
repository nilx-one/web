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

export function readGuideIntro(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): GuideIntroMemory | undefined {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const intro = (parsed as { intro?: unknown }).intro;
    return intro === "skipped" || intro === "done" ? intro : undefined;
  } catch {
    return undefined;
  }
}

export function rememberGuideIntro(
  owner: string,
  intro: GuideIntroMemory,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify({ intro }));
  } catch {
    // Storage is optional: she simply introduces herself again next time.
  }
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
