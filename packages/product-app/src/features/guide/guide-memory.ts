// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Whether xSasha's introduction still has to be played for a Bond.
 *
 * Two answers are kept on this device: the scene was played through, or a
 * person skipped it. "Later" is kept too, with when it was said and how many
 * times — she comes back on her own schedule, see `guideIntroWaitMs`. None of
 * it is sent anywhere, and none of it is a fact about the Bond: it is a play
 * record, transport-eligible like the rest of them.
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

/**
 * "Later", said as often as this Bond put her off: how many times, and when
 * last. Kept apart from the introduction's own answer, which ends it.
 */
export interface GuideSnooze {
  readonly skips: number;
  readonly at: number;
}

const MINUTE_MS = 60_000;
/** Put off once, she stays away from the next login for at least this long. */
export const GUIDE_SNOOZE_MIN_MS = 30 * MINUTE_MS;
/** ... and comes back on her own, login or not, after at most this long. */
export const GUIDE_SNOOZE_MAX_MS = 60 * MINUTE_MS;
/** Each time she is put off, both waits double. This only keeps it finite. */
const GUIDE_SNOOZE_MAX_DOUBLINGS = 16;

/** What this session put off, for a device that has nowhere to keep it. */
const postponed = new Map<string, GuideSnooze>();

function defaultStorage(): GuideMemoryStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

interface GuideRecord {
  readonly intro?: GuideIntroMemory;
  readonly introSnooze?: GuideSnooze;
  readonly territory?: GuideTerritoryMemory;
}

function readSnoozeField(value: unknown): GuideSnooze | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { skips, at } = value as Record<string, unknown>;
  return typeof skips === "number" &&
    Number.isInteger(skips) &&
    skips >= 1 &&
    typeof at === "number" &&
    Number.isFinite(at) &&
    at >= 0
    ? { skips, at }
    : undefined;
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
    const { intro, introSnooze, territory } = parsed as Record<string, unknown>;
    const snooze = readSnoozeField(introSnooze);
    return {
      ...(intro === "skipped" || intro === "done" ? { intro } : {}),
      ...(snooze === undefined ? {} : { introSnooze: snooze }),
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

/** How long each wait is after she was put off `skips` times. */
export function guideSnoozeWindow(skips: number): {
  readonly minMs: number;
  readonly maxMs: number;
} {
  const doublings = Math.min(
    Math.max(skips, 1) - 1,
    GUIDE_SNOOZE_MAX_DOUBLINGS,
  );
  const factor = 2 ** doublings;
  return {
    minMs: GUIDE_SNOOZE_MIN_MS * factor,
    maxMs: GUIDE_SNOOZE_MAX_MS * factor,
  };
}

function readSnooze(
  owner: string,
  storage: GuideMemoryStorage | undefined,
): GuideSnooze | undefined {
  const kept = readRecord(owner, storage).introSnooze;
  const session = postponed.get(owner);
  if (kept === undefined) return session;
  if (session === undefined) return kept;
  return session.at >= kept.at ? session : kept;
}

function writeSnooze(
  owner: string,
  snooze: GuideSnooze,
  storage: GuideMemoryStorage | undefined,
): void {
  postponed.set(owner, snooze);
  writeRecord(owner, { introSnooze: snooze }, storage);
}

/** She was put off: once more, as of `nowMs`. */
export function postponeGuideIntro(
  owner: string,
  nowMs: number = Date.now(),
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): void {
  const skips = (readSnooze(owner, storage)?.skips ?? 0) + 1;
  writeSnooze(owner, { skips, at: nowMs }, storage);
}

/** Whether the introduction is still to be played, whenever that may be. */
export function guideIntroOwed(
  owner: string,
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): boolean {
  return readGuideIntro(owner, storage) === undefined;
}

/**
 * How long until she may walk up again: 0 when she may now.
 *
 * Put off once, she keeps away from a login that comes before
 * `GUIDE_SNOOZE_MIN_MS` has passed, takes the first login after it, and comes
 * on her own when `GUIDE_SNOOZE_MAX_MS` has passed. Each time she is put off
 * both double. `openedAtMs` is when the world was opened, which is the login:
 * putting her off in this very session never counts as having come back to it.
 */
export function guideIntroWaitMs(
  owner: string,
  openedAtMs: number,
  nowMs: number = Date.now(),
  storage: GuideMemoryStorage | undefined = defaultStorage(),
): number {
  const snooze = readSnooze(owner, storage);
  if (snooze === undefined) return 0;
  // A clock set back would leave her waiting for a time that has not come:
  // she was put off as of now, as far as this device can tell.
  let at = snooze.at;
  if (at > nowMs) {
    at = nowMs;
    writeSnooze(owner, { skips: snooze.skips, at }, storage);
  }
  const { minMs, maxMs } = guideSnoozeWindow(snooze.skips);
  if (at < openedAtMs && openedAtMs - at >= minMs) return 0;
  return Math.max(0, maxMs - (nowMs - at));
}

/** Forgets what this session put off. For tests. */
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
