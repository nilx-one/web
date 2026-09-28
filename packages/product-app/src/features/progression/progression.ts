// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What a Bond and its Avaia have earned by playing: fog either of them
 * revealed, monuments either of them studied, and the achievements that pay
 * once.
 *
 * Activity experience is `pub_info` on the Bond's `.bnd`: one shared total
 * the owner asserts, synced through the identity service and readable with
 * the public Bond. The service labels that total `authority: "client"`. It
 * stores the report; it does not price an action or attest the play. This
 * device keeps a copy so play still counts while a request is in flight,
 * and it keeps the achievements that are about this device. That local copy
 * is transport-eligible (state-placement.ts): not synced state and not
 * service state. Levels are derived here. Nothing in this file is BondChain
 * evidence.
 *
 * The Bond and its Avaia level apart. What the owner did themselves pays the
 * Bond; what the Avaia did pays the Avaia. The two curves are deliberately
 * different: an Avaia climbs linearly and a high level is ordinary, a Bond
 * climbs a steep curve and every level past the first is a real amount of play.
 */

import type {
  ExperienceEvent,
  ExperiencePublication,
  PubInfoAccessPort,
  PubInfoExperience,
} from "@nilx-one/application";

/**
 * The base unit ("n") the activity economy is priced in. Revealing a zone
 * yourself is worth more than sending the Avaia to do it (walking there is
 * the harder thing); studying a monument is worth more from the Avaia than
 * from a passing glance (the Avaia's study is the one that keeps every fact
 * the archive has, verbatim). Tune the whole table by changing this one
 * number.
 */
export const EXPERIENCE_UNIT = 10;

/** The Avaia opened a zone (fog cell) on its own. Pays the Avaia. */
export const XP_ZONE_REVEALED_BY_AVAIA = EXPERIENCE_UNIT;
/** The owner walked into a fogged zone themselves. Pays the Bond. */
export const XP_ZONE_REVEALED_MANUALLY = EXPERIENCE_UNIT * 3;
/** The Avaia walked up to a landmark and studied it. Pays the Avaia. */
export const XP_LANDMARK_STUDIED_BY_AVAIA = EXPERIENCE_UNIT * 4.5;
/** The owner's own device passed close enough to notice a landmark. Pays the Bond. */
export const XP_LANDMARK_NOTICED_MANUALLY = EXPERIENCE_UNIT * 2;

export type Earner = "bond" | "avaia";

/**
 * Something that pays once.
 *
 * An `account` achievement is read from what the identity service already
 * keeps, so every device that reads the same fact counts it exactly once and
 * none of them has to remember paying it. A `device` achievement is something
 * this device did for this Bond, so each host — the web, Telegram, Discord —
 * earns it on its own.
 */
export type AchievementId = "avaia-configured" | "avaia-model-downloaded";
export type AchievementScope = "account" | "device";

export interface Achievement {
  readonly id: AchievementId;
  readonly scope: AchievementScope;
  readonly bondXp: number;
  readonly avaiaXp: number;
}

export const ACHIEVEMENTS: Readonly<Record<AchievementId, Achievement>> = {
  "avaia-configured": {
    id: "avaia-configured",
    scope: "account",
    bondXp: 20,
    avaiaXp: 0,
  },
  "avaia-model-downloaded": {
    id: "avaia-model-downloaded",
    scope: "device",
    bondXp: 50,
    avaiaXp: 100,
  },
};

const ACHIEVEMENT_ORDER: readonly AchievementId[] = [
  "avaia-configured",
  "avaia-model-downloaded",
];

/**
 * What Bond level `level` costs in total: `50 · level³`. Level 1 is one or two
 * actions away (configuring the Avaia and walking one zone open, say); level 4
 * already takes thousands.
 */
export const BOND_LEVEL_BASE = 50;

export function bondExperienceForLevel(level: number): number {
  return level <= 0 ? 0 : BOND_LEVEL_BASE * level ** 3;
}

export function bondLevelForExperience(totalXp: number): number {
  let level = 0;
  while (bondExperienceForLevel(level + 1) <= totalXp) level += 1;
  return level;
}

/**
 * An Avaia reaches level 1 by being configured, then climbs one level per 150
 * experience with no ceiling: level 2 at 150, level 3 at 300, level 100 at
 * 14,850. Experience an unconfigured Avaia earns is kept, and counts the
 * moment it is configured.
 */
export const AVAIA_EXPERIENCE_PER_LEVEL = 150;

export function avaiaExperienceForLevel(level: number): number {
  return level <= 1 ? 0 : AVAIA_EXPERIENCE_PER_LEVEL * (level - 1);
}

export function avaiaLevelForExperience(
  totalXp: number,
  configured: boolean,
): number {
  if (!configured) return 0;
  return 1 + Math.floor(Math.max(0, totalXp) / AVAIA_EXPERIENCE_PER_LEVEL);
}

/**
 * What this device remembers for one Bond, plus the shared totals it last
 * read from `pub_info`. Levels are derived, never stored.
 */
export interface Progression {
  /**
   * Activity experience this device had earned before it was part of
   * `pub_info`. It is offered once as carry, then the shared total takes over.
   */
  readonly bondXp: number;
  /** The Avaia's pre-sync activity, offered once as carry. */
  readonly avaiaXp: number;
  readonly deviceAchievements: readonly AchievementId[];
  /** The owner has already been pointed at Settings for the next step. */
  readonly settingsHintSeen: boolean;
  /** Activity experience `pub_info` already holds for the Bond. */
  readonly publishedBondXp: number;
  /** Activity experience `pub_info` already holds for the Avaia. */
  readonly publishedAvaiaXp: number;
  /** Awards from this device that `pub_info` has not accepted yet. */
  readonly pendingEvents: readonly ExperienceEvent[];
  /** The pre-sync totals have been offered as carry. */
  readonly carrySubmitted: boolean;
}

export const EMPTY_PROGRESSION: Progression = {
  bondXp: 0,
  avaiaXp: 0,
  deviceAchievements: [],
  settingsHintSeen: false,
  publishedBondXp: 0,
  publishedAvaiaXp: 0,
  pendingEvents: [],
  carrySubmitted: false,
};

/** Service-kept facts account achievements are read from. */
export interface AccountFacts {
  readonly avaiaConfigured: boolean;
}

export interface LevelStanding {
  readonly xp: number;
  readonly level: number;
  /**
   * Total experience the next level costs. Zero for an unconfigured Avaia,
   * whose level 1 is paid by configuring it rather than by experience.
   */
  readonly nextLevelXp: number;
}

export interface ProgressionStanding {
  readonly bond: LevelStanding;
  readonly avaia: LevelStanding;
  readonly achievements: readonly AchievementId[];
}

export function earnedAchievements(
  progression: Progression,
  facts: AccountFacts,
): readonly AchievementId[] {
  return ACHIEVEMENT_ORDER.filter((id) =>
    ACHIEVEMENTS[id].scope === "account"
      ? id === "avaia-configured" && facts.avaiaConfigured
      : progression.deviceAchievements.includes(id),
  );
}

/** Activity experience, before achievements: the shared total plus anything still unsent. */
export function activityExperience(progression: Progression): {
  bondXp: number;
  avaiaXp: number;
} {
  const baseBond = progression.carrySubmitted
    ? progression.publishedBondXp
    : progression.bondXp;
  const baseAvaia = progression.carrySubmitted
    ? progression.publishedAvaiaXp
    : progression.avaiaXp;
  return progression.pendingEvents.reduce(
    (totals, event) =>
      event.earner === "bond"
        ? { ...totals, bondXp: totals.bondXp + event.amount }
        : { ...totals, avaiaXp: totals.avaiaXp + event.amount },
    { bondXp: baseBond, avaiaXp: baseAvaia },
  );
}

export function progressionStanding(
  progression: Progression,
  facts: AccountFacts,
): ProgressionStanding {
  const achievements = earnedAchievements(progression, facts);
  const activity = activityExperience(progression);
  const bondXp =
    activity.bondXp +
    achievements.reduce((sum, id) => sum + ACHIEVEMENTS[id].bondXp, 0);
  const avaiaXp =
    activity.avaiaXp +
    achievements.reduce((sum, id) => sum + ACHIEVEMENTS[id].avaiaXp, 0);
  const bondLevel = bondLevelForExperience(bondXp);
  const avaiaLevel = avaiaLevelForExperience(avaiaXp, facts.avaiaConfigured);
  return {
    bond: {
      xp: bondXp,
      level: bondLevel,
      nextLevelXp: bondExperienceForLevel(bondLevel + 1),
    },
    avaia: {
      xp: avaiaXp,
      level: avaiaLevel,
      nextLevelXp: avaiaExperienceForLevel(avaiaLevel + 1),
    },
    achievements,
  };
}

/** Pure: adds activity experience to whoever earned it. */
export function awardExperience(
  progression: Progression,
  earner: Earner,
  amount: number,
): Progression {
  if (amount <= 0) return progression;
  return earner === "bond"
    ? { ...progression, bondXp: progression.bondXp + amount }
    : { ...progression, avaiaXp: progression.avaiaXp + amount };
}

const EVENT_ID = /^xp:[A-Za-z0-9._-]{1,76}$/;
const MAX_EVENT_AMOUNT = 10_000;

/**
 * An opaque nonce for one award. The prefix is fixed and the rest is random,
 * so the id can be retried without ever naming a cell or a landmark.
 */
export function newExperienceEventId(): string {
  const nonce =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `xp:${nonce}`;
}

/** Queues one award for `pub_info`. A repeat of the same id pays nothing. */
export function queueExperience(
  progression: Progression,
  event: ExperienceEvent,
): Progression {
  const amount = Math.round(event.amount);
  if (
    !EVENT_ID.test(event.id) ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount > MAX_EVENT_AMOUNT ||
    progression.pendingEvents.some((pending) => pending.id === event.id)
  ) {
    return progression;
  }
  return {
    ...progression,
    pendingEvents: [
      ...progression.pendingEvents,
      { id: event.id, earner: event.earner, amount },
    ],
  };
}

/** What still has to be offered to `pub_info`. */
export function experienceToPublish(
  progression: Progression,
): ExperiencePublication {
  return {
    ...(progression.carrySubmitted
      ? {}
      : {
          carry: {
            bondXp: carryAmount(progression.bondXp),
            avaiaXp: carryAmount(progression.avaiaXp),
          },
        }),
    events: progression.pendingEvents,
  };
}

const MAX_CARRY_XP = 1_000_000_000;

function carryAmount(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) return 0;
  return Math.min(value, MAX_CARRY_XP);
}

/**
 * Folds an accepted `pub_info` total back into what this device remembers.
 * Acknowledged events leave the pending queue; anything earned during the
 * request stays in it.
 */
export function notePublishedExperience(
  progression: Progression,
  published: PubInfoExperience,
  acknowledged: readonly string[],
): Progression {
  const acked = new Set(acknowledged);
  const pendingEvents = progression.pendingEvents.filter(
    (event) => !acked.has(event.id),
  );
  if (
    progression.carrySubmitted &&
    progression.publishedBondXp === published.bondXp &&
    progression.publishedAvaiaXp === published.avaiaXp &&
    pendingEvents.length === progression.pendingEvents.length
  ) {
    return progression;
  }
  return {
    ...progression,
    publishedBondXp: published.bondXp,
    publishedAvaiaXp: published.avaiaXp,
    carrySubmitted: true,
    pendingEvents,
  };
}

/** The standing anyone can read from published totals and account facts. */
export function standingForPublishedExperience(
  experience: PubInfoExperience,
  facts: AccountFacts,
): ProgressionStanding {
  return progressionStanding(
    {
      ...EMPTY_PROGRESSION,
      publishedBondXp: experience.bondXp,
      publishedAvaiaXp: experience.avaiaXp,
      carrySubmitted: true,
    },
    facts,
  );
}

/** Pays a device achievement once; a repeat pays nothing. */
export function earnDeviceAchievement(
  progression: Progression,
  id: AchievementId,
): Progression {
  if (
    ACHIEVEMENTS[id].scope !== "device" ||
    progression.deviceAchievements.includes(id)
  ) {
    return progression;
  }
  return {
    ...progression,
    deviceAchievements: [...progression.deviceAchievements, id],
  };
}

export function markSettingsHintSeen(progression: Progression): Progression {
  return progression.settingsHintSeen
    ? progression
    : { ...progression, settingsHintSeen: true };
}

const STORAGE_PREFIX = "nilx-one.progression.v3.";
const PREVIOUS_STORAGE_PREFIX = "nilx-one.progression.v2.";
const LEGACY_STORAGE_PREFIX = "nilx-one.progression.v1.";
/** What version 1 paid for configuring, before that became an account achievement. */
const LEGACY_CONFIGURED_REWARD = 40;

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

function isAchievementId(value: unknown): value is AchievementId {
  return typeof value === "string" && value in ACHIEVEMENTS;
}

function parseProgression(value: unknown): Progression | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.bondXp !== "number" ||
    typeof candidate.avaiaXp !== "number" ||
    !Array.isArray(candidate.deviceAchievements) ||
    typeof candidate.settingsHintSeen !== "boolean"
  ) {
    return undefined;
  }
  return {
    bondXp: candidate.bondXp,
    avaiaXp: candidate.avaiaXp,
    deviceAchievements: candidate.deviceAchievements.filter(isAchievementId),
    settingsHintSeen: candidate.settingsHintSeen,
    publishedBondXp: nonNegative(candidate.publishedBondXp),
    publishedAvaiaXp: nonNegative(candidate.publishedAvaiaXp),
    pendingEvents: parsePendingEvents(candidate.pendingEvents),
    carrySubmitted: candidate.carrySubmitted === true,
  };
}

function nonNegative(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

function parsePendingEvents(value: unknown): readonly ExperienceEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const candidate = entry as Record<string, unknown>;
    const amount = Math.round(
      typeof candidate.amount === "number" ? candidate.amount : 0,
    );
    if (
      typeof candidate.id !== "string" ||
      !EVENT_ID.test(candidate.id) ||
      (candidate.earner !== "bond" && candidate.earner !== "avaia") ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount > MAX_EVENT_AMOUNT
    ) {
      return [];
    }
    return [
      {
        id: candidate.id,
        earner: candidate.earner,
        amount,
      },
    ];
  });
}

/**
 * Version 1 kept one total for the Bond. It carries over as the Bond's own
 * activity, less the configuration reward it used to pay — that is now read
 * from the service instead, and paying it twice would be a gift, not a record.
 */
function parseLegacyProgression(value: unknown): Progression | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.totalXp !== "number" ||
    typeof candidate.avaiaConfigured !== "boolean"
  ) {
    return undefined;
  }
  return {
    ...EMPTY_PROGRESSION,
    bondXp: Math.max(
      0,
      candidate.totalXp -
        (candidate.avaiaConfigured ? LEGACY_CONFIGURED_REWARD : 0),
    ),
  };
}

function readJson(
  storage: ProgressionStorage | undefined,
  key: string,
): unknown {
  const raw = storage?.getItem(key);
  return raw === null || raw === undefined ? undefined : JSON.parse(raw);
}

/** What this device remembers earning for one Bond. Never throws, never guesses. */
export function readProgression(
  owner: string,
  storage: ProgressionStorage | undefined = defaultStorage(),
): Progression {
  try {
    const current = readJson(storage, STORAGE_PREFIX + owner);
    if (current !== undefined) {
      return parseProgression(current) ?? EMPTY_PROGRESSION;
    }
    // Version 2 is the same activity totals, kept locally before they were
    // pub_info. Reading it offers them once as carry.
    const previous = readJson(storage, PREVIOUS_STORAGE_PREFIX + owner);
    if (previous !== undefined) {
      return parseProgression(previous) ?? EMPTY_PROGRESSION;
    }
    const legacy = readJson(storage, LEGACY_STORAGE_PREFIX + owner);
    return parseLegacyProgression(legacy) ?? EMPTY_PROGRESSION;
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

// One record per Bond for the whole page, read from storage once. It is an
// external store rather than component state because what fills it — a
// reveal, a study, a download — is not a render: nothing that earns
// experience should have to schedule one.
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

const publicationFlights = new Map<
  string,
  { running: boolean; again: boolean }
>();

/**
 * Offers this device's unsent experience to `pub_info` and adopts the shared
 * total. A refusal leaves the local record as it was, so the next attempt
 * can offer the same awards again. Overlapping calls for one Bond collapse
 * into one flight.
 */
export async function publishProgression(
  owner: string,
  port: PubInfoAccessPort,
): Promise<void> {
  const flight = publicationFlights.get(owner) ?? {
    running: false,
    again: false,
  };
  publicationFlights.set(owner, flight);
  if (flight.running) {
    flight.again = true;
    return;
  }
  flight.running = true;
  try {
    do {
      flight.again = false;
      await flushProgression(owner, port);
    } while (flight.again);
  } finally {
    flight.running = false;
  }
}

async function flushProgression(
  owner: string,
  port: PubInfoAccessPort,
): Promise<void> {
  const current = progressionSnapshot(owner);
  const payload = experienceToPublish(current);
  const acknowledged = payload.events.map((event) => event.id);
  const sending = payload.carry !== undefined || payload.events.length > 0;
  let result;
  try {
    result = sending
      ? await port.publishExperience(payload)
      : await port.readPubInfo();
  } catch {
    return;
  }
  if (result.kind !== "published") return;
  const experience = result.experience;
  updateProgression(owner, (latest) =>
    notePublishedExperience(latest, experience, sending ? acknowledged : []),
  );
}
