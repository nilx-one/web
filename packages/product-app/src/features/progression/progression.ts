// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What a Bond has earned by playing: fog it or its Avaia revealed, monuments
 * it or its Avaia studied, and the one-time reward for actually configuring
 * an owned Avaia. This is local presentation, in the same sense fog reveals
 * and the landmark notebook are: what this device kept track of for one
 * Bond, never synced, exported, or asserted as a protocol fact. It is not
 * BondChain evidence and it is not identity state — Core and the identity
 * service know nothing about it.
 */

/**
 * The base unit ("n") the whole economy is priced in. Revealing a zone
 * yourself is worth more than sending the Avaia to do it (walking there is
 * the harder thing); studying a monument is worth more from the Avaia than
 * from a passing glance (the Avaia's study is the one that keeps every fact
 * the archive has, verbatim). Tune the whole table by changing this one
 * number.
 */
export const EXPERIENCE_UNIT = 10;

/** The Avaia opened a zone (fog cell) on its own. */
export const XP_ZONE_REVEALED_BY_AVAIA = EXPERIENCE_UNIT;
/** The owner walked into a fogged zone themselves. */
export const XP_ZONE_REVEALED_MANUALLY = EXPERIENCE_UNIT * 3;
/** The Avaia walked up to a landmark and studied it. */
export const XP_LANDMARK_STUDIED_BY_AVAIA = EXPERIENCE_UNIT * 4.5;
/** The owner's own device passed close enough to notice a landmark. */
export const XP_LANDMARK_NOTICED_MANUALLY = EXPERIENCE_UNIT * 2;

/** What level 1 costs. Configuring an owned Avaia pays exactly this much. */
export const LEVEL_ONE_EXPERIENCE = 40;
/** The one-time reward for the owner-controlled Avaia setup save. */
export const XP_AVAIA_CONFIGURED = LEVEL_ONE_EXPERIENCE;

/**
 * Not yet: only level 1's threshold has been decided. A curve past it is a
 * product decision this file does not guess at, so experience keeps
 * accumulating without climbing past level 1 until that design lands.
 */
export function levelForExperience(totalXp: number): number {
  return totalXp >= LEVEL_ONE_EXPERIENCE ? 1 : 0;
}

export interface Progression {
  readonly totalXp: number;
  readonly level: number;
  /** Guards the one-time configuration reward against a repeat save. */
  readonly avaiaConfigured: boolean;
}

export const EMPTY_PROGRESSION: Progression = {
  totalXp: 0,
  level: 0,
  avaiaConfigured: false,
};

const STORAGE_PREFIX = "nilx-one.progression.v1.";

export interface ProgressionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): ProgressionStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isProgression(value: unknown): value is Progression {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.totalXp === "number" &&
    typeof candidate.level === "number" &&
    typeof candidate.avaiaConfigured === "boolean"
  );
}

/** What this device remembers earning for one Bond. Never throws, never guesses. */
export function readProgression(
  owner: string,
  storage: ProgressionStorage | undefined = defaultStorage(),
): Progression {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return EMPTY_PROGRESSION;
    const parsed: unknown = JSON.parse(raw);
    return isProgression(parsed) ? parsed : EMPTY_PROGRESSION;
  } catch {
    return EMPTY_PROGRESSION;
  }
}

export function writeProgression(
  owner: string,
  progression: Progression,
  storage: ProgressionStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify(progression));
  } catch {
    // Remembering is best-effort: a full or blocked store forgets, it never breaks the world.
  }
}

/** Pure: adds experience and recomputes the level it now reads as. */
export function awardExperience(
  progression: Progression,
  amount: number,
): Progression {
  if (amount <= 0) return progression;
  const totalXp = progression.totalXp + amount;
  return { ...progression, totalXp, level: levelForExperience(totalXp) };
}

/** Pays the one-time configuration reward; a repeat save pays nothing. */
export function markAvaiaConfigured(progression: Progression): Progression {
  if (progression.avaiaConfigured) return progression;
  return awardExperience(
    { ...progression, avaiaConfigured: true },
    XP_AVAIA_CONFIGURED,
  );
}

// One record per Bond for the whole page, read from storage once. It is an
// external store rather than component state because what fills it — a
// reveal, a study, a save — is not a render: nothing that earns experience
// should have to schedule one.
const progressions = new Map<string, Progression>();
const progressionListeners = new Set<() => void>();

export function progressionSnapshot(owner: string): Progression {
  const cached = progressions.get(owner);
  if (cached !== undefined) return cached;
  const read = readProgression(owner);
  progressions.set(owner, read);
  return read;
}

export function updateProgression(
  owner: string,
  change: (progression: Progression) => Progression,
): Progression {
  const current = progressionSnapshot(owner);
  const next = change(current);
  if (next === current) return current;
  progressions.set(owner, next);
  writeProgression(owner, next);
  for (const listener of [...progressionListeners]) listener();
  return next;
}

export function subscribeProgression(listener: () => void): () => void {
  progressionListeners.add(listener);
  return () => progressionListeners.delete(listener);
}

/** Forgets what was read, so the next snapshot reads storage again. */
export function forgetProgressionCache(): void {
  progressions.clear();
}
