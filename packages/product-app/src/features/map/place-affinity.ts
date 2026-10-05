// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * The places an Avaia grew fond of, and the ones it fell for
 * (docs/avaia-walk.md, "Favourite places").
 *
 * Every visit leaves a feeling behind. How much an Avaia enjoyed a place is
 * worked out in code from three things: its temperament, which its address
 * decides once and for good (one Avaia is drawn to water, another to old
 * stone); the chemistry between that address and that one place, so two
 * parks are never quite the same park; and the taste it has built up so far,
 * which every visit moves a little. Fondness follows enjoyment visit by
 * visit, fades while a place is left alone, and a place enjoyed enough, often
 * enough, is loved. Love fades no further than a floor.
 *
 * Nothing here is produced by a model, so it means the same on every device
 * and under every model (docs/mind.md in nilx-one/ai): a model may read how
 * the Avaia feels about an option, never write it. The record is one Bond's
 * own, kept for its Avaia, never sent anywhere and never training signal. It
 * asserts nothing about presence, attendance or any Bond: it is about where a
 * body this device draws liked to stand.
 */

/** What kind of place moves an Avaia: the axis its temperament is drawn on. */
export type PlaceFamily = "nature" | "heights" | "history" | "art";

export const PLACE_FAMILIES: readonly PlaceFamily[] = [
  "nature",
  "heights",
  "history",
  "art",
];

/** What an Avaia does at a place: rests in a park, gazes off a height, studies stone. */
export type PlaceActivity = "rest" | "gaze" | "study";

const FAMILY_OF: Readonly<Record<string, PlaceFamily>> = {
  park: "nature",
  lake: "nature",
  nature_reserve: "nature",
  beach: "nature",
  spring: "nature",
  picnic_site: "nature",
  camp_site: "nature",
  bird_hide: "nature",
  viewpoint: "heights",
  peak: "heights",
  tower: "heights",
  cairn: "heights",
  castle: "history",
  fort: "history",
  ruins: "history",
  archaeological_site: "history",
  historic_building: "history",
  historic: "history",
  memorial: "history",
  monument: "history",
  major_monument: "history",
  small_monument: "history",
  shrine: "history",
  cross: "history",
  church: "history",
  museum: "art",
  artwork: "art",
  sculpture: "art",
  statue: "art",
  fountain: "art",
  bridge: "art",
  attraction: "art",
  landmark: "art",
};

const ACTIVITY_OF: Readonly<Record<PlaceFamily, PlaceActivity>> = {
  nature: "rest",
  heights: "gaze",
  history: "study",
  art: "study",
};

/** A kind the vocabulary does not place is something made to be looked at. */
export function placeFamily(kind: string): PlaceFamily {
  return FAMILY_OF[kind] ?? "art";
}

export function placeActivity(kind: string): PlaceActivity {
  return ACTIVITY_OF[placeFamily(kind)];
}

/** Fondness, 0 to 1, at or above which a place is a favourite. */
export const FOND_AT = 0.4;

/** Fondness at or above which, after `LOVE_VISITS` visits, a place is loved. */
export const LOVE_AT = 0.62;

/** Love is not at first sight: a place is loved only once it was come back to. */
export const LOVE_VISITS = 3;

/**
 * What a first visit leaves, as a share of how it went: a first impression.
 * Enough that a place enjoyed at 0.67 or more is a favourite at once, and so
 * worth coming back to; a lukewarm one is only known.
 */
export const FIRST_IMPRESSION = 0.6;

/** How far each later visit moves fondness toward what that visit was like. */
export const FONDNESS_LEARNING = 0.4;

/** How far each visit moves taste for that family of places. */
export const TASTE_LEARNING = 0.15;

/** A place left alone this long is half as dear. */
export const FONDNESS_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** A loved place is never less dear than this, however long it is left. */
export const LOVED_FLOOR = 0.5;

/** Longing for a place grows back to full over this long away from it. */
export const LONGING_RAMP_MS = 2 * 24 * 60 * 60 * 1000;

/** Longing at or above which an idle Avaia goes back on its own. */
export const RETURN_LONGING = 0.35;

/** A loved place can be gone back to after this long; a favourite after `FOND_RETURN_MS`. */
export const LOVED_RETURN_MS = 24 * 60 * 60 * 1000;
export const FOND_RETURN_MS = 3 * 24 * 60 * 60 * 1000;

/** How long a visit lasts, by what is done there, before fondness stretches it. */
export const LINGER_MS: Readonly<Record<PlaceActivity, number>> = {
  rest: 90_000,
  gaze: 45_000,
  study: 30_000,
};

/** Enough places for a city's worth of walks, few enough to stay a feeling. */
export const AFFINITY_LIMIT = 64;

/** One place an Avaia has been to and what it feels about it. */
export interface FondPlace {
  /** The landmark's stable id: the same feature across tiles and sessions. */
  readonly id: string;
  readonly kind: string;
  readonly name?: string | undefined;
  readonly longitude: number;
  readonly latitude: number;
  /** 0 to 1, as of `lastAt`; `fondnessAt` says what it is now. */
  readonly fondness: number;
  readonly visits: number;
  readonly firstAt: number;
  readonly lastAt: number;
  /** When it was first loved. Love is remembered once it happened. */
  readonly lovedAt?: number | undefined;
}

export interface PlaceAffinity {
  /** The Avaia address whose feelings these are. */
  readonly by: string;
  readonly places: readonly FondPlace[];
  /** 0 to 1 per family, 0.5 when nothing has been learned yet. */
  readonly taste: Readonly<Partial<Record<PlaceFamily, number>>>;
}

export function emptyAffinity(by: string): PlaceAffinity {
  return { by, places: [], taste: {} };
}

/** Where an Avaia stands among the families before it has been anywhere. */
export type Temperament = Readonly<Record<PlaceFamily, number>>;

/**
 * The temperament an address is born with: each family from 0.3 to 0.9. The
 * same address always gets the same temperament, on any device, so it never
 * has to travel.
 */
export function temperament(address: string): Temperament {
  const seed = hash(address);
  const entries = PLACE_FAMILIES.map((family, index) => [
    family,
    0.3 + 0.6 * unit(mix(seed + index * 0x9e37)),
  ]);
  return Object.fromEntries(entries) as Record<PlaceFamily, number>;
}

/**
 * The chemistry between an Avaia and one place, 0 to 1: why one park is the
 * park and another is only a park. Fixed for the pair, never learned.
 */
export function chemistry(address: string, placeId: string): number {
  return unit(mix(hash(`${address}\u0000${placeId}`)));
}

/** How well an hour suits a family of places, 0 to 1. */
export function hourFit(family: PlaceFamily, hour: number): number {
  switch (family) {
    case "nature":
      return hour >= 9 && hour < 19 ? 1 : 0.4;
    case "heights":
      if ((hour >= 6 && hour < 8) || (hour >= 18 && hour < 21)) return 1;
      return hour >= 8 && hour < 18 ? 0.7 : 0.3;
    case "history":
    case "art":
      return hour >= 10 && hour < 18 ? 1 : 0.5;
  }
}

export function tasteFor(affinity: PlaceAffinity, family: PlaceFamily): number {
  return affinity.taste[family] ?? 0.5;
}

/** How much one visit to a place was enjoyed, 0 to 1. */
export function enjoyment(
  affinity: PlaceAffinity,
  place: { readonly id: string; readonly kind: string },
  hour: number,
): number {
  const family = placeFamily(place.kind);
  return clamp01(
    0.4 * temperament(affinity.by)[family] +
      0.3 * chemistry(affinity.by, place.id) +
      0.2 * tasteFor(affinity, family) +
      0.1 * hourFit(family, hour),
  );
}

/** How dear a place is at `now`: fondness faded by the time left alone. */
export function fondnessAt(place: FondPlace, now: number): number {
  const away = Math.max(0, now - place.lastAt);
  const faded = place.fondness * 0.5 ** (away / FONDNESS_HALF_LIFE_MS);
  return place.lovedAt === undefined
    ? faded
    : Math.max(Math.min(LOVED_FLOOR, place.fondness), faded);
}

export function isLoved(place: FondPlace): boolean {
  return place.lovedAt !== undefined;
}

/** How much an Avaia wants to go back, 0 to 1: dearness, grown back with absence. */
export function longing(place: FondPlace, now: number): number {
  const away = Math.max(0, now - place.lastAt);
  return fondnessAt(place, now) * Math.min(1, away / LONGING_RAMP_MS);
}

/** How a model may read an Avaia's feeling for an option: a closed label, no more. */
export type PlaceFeeling = "new" | "known" | "fond" | "loved";

export function feelingFor(
  affinity: PlaceAffinity,
  id: string,
  now: number,
): PlaceFeeling {
  const place = findPlace(affinity, id);
  if (place === undefined) return "new";
  if (isLoved(place)) return "loved";
  return fondnessAt(place, now) >= FOND_AT ? "fond" : "known";
}

export function findPlace(
  affinity: PlaceAffinity,
  id: string,
): FondPlace | undefined {
  return affinity.places.find((place) => place.id === id);
}

/**
 * How long after a visit a place may be gone back to: a day for one it
 * loves, three for a favourite, `fallbackMs` for anything else.
 */
export function returnAfterMs(
  affinity: PlaceAffinity,
  id: string,
  now: number,
  fallbackMs: number,
): number {
  const place = findPlace(affinity, id);
  if (place === undefined) return fallbackMs;
  if (isLoved(place)) return LOVED_RETURN_MS;
  return fondnessAt(place, now) >= FOND_AT ? FOND_RETURN_MS : fallbackMs;
}

/** How long a visit lasts: by what is done there, and up to twice that where it is dear. */
export function lingerMs(
  affinity: PlaceAffinity,
  place: { readonly id: string; readonly kind: string },
  now: number,
): number {
  const known = findPlace(affinity, place.id);
  const dear = known === undefined ? 0 : fondnessAt(known, now);
  return Math.round(LINGER_MS[placeActivity(place.kind)] * (1 + dear));
}

export interface VisitedPlace {
  readonly id: string;
  readonly kind: string;
  readonly name?: string | undefined;
  readonly longitude: number;
  readonly latitude: number;
}

export interface Visit {
  readonly affinity: PlaceAffinity;
  readonly place: FondPlace;
  /** True on the one visit after which the place is loved. */
  readonly fellInLove: boolean;
}

/**
 * One visit, felt. A first visit leaves a first impression; each later one
 * moves fondness from what it was, faded, toward how much it was enjoyed.
 * Taste for the family moves a little the same way. The place is loved the
 * first time it is dear enough after enough visits.
 */
export function recordVisit(
  affinity: PlaceAffinity,
  visited: VisitedPlace,
  at: number,
  hour: number,
): Visit {
  const before = findPlace(affinity, visited.id);
  const felt = enjoyment(affinity, visited, hour);
  const was = before === undefined ? undefined : fondnessAt(before, at);
  const fondness = clamp01(
    was === undefined
      ? felt * FIRST_IMPRESSION
      : was + (felt - was) * FONDNESS_LEARNING,
  );
  const visits = (before?.visits ?? 0) + 1;
  const fellInLove =
    before?.lovedAt === undefined &&
    visits >= LOVE_VISITS &&
    fondness >= LOVE_AT;
  const lovedAt = before?.lovedAt ?? (fellInLove ? at : undefined);
  const name = visited.name?.trim() || before?.name;
  const place: FondPlace = {
    id: visited.id,
    kind: visited.kind,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    longitude: visited.longitude,
    latitude: visited.latitude,
    fondness,
    visits,
    firstAt: before?.firstAt ?? at,
    lastAt: at,
    ...(lovedAt === undefined ? {} : { lovedAt }),
  };
  const family = placeFamily(visited.kind);
  const taste = tasteFor(affinity, family);
  const places = [
    ...affinity.places.filter((entry) => entry.id !== visited.id),
    place,
  ];
  return {
    affinity: {
      ...affinity,
      places: keepDearest(places, at),
      taste: {
        ...affinity.taste,
        [family]: clamp01(taste + (felt - taste) * TASTE_LEARNING),
      },
    },
    place,
    fellInLove,
  };
}

/** A place as a landmark a line or a list can name; the archive's facts are not kept here. */
export function placeLandmark(place: FondPlace): MapLandmark {
  return {
    id: place.id,
    kind: place.kind,
    ...(place.name === undefined ? {} : { name: place.name }),
    longitude: place.longitude,
    latitude: place.latitude,
    facts: {},
  };
}

/**
 * The favourites, dearest first: loved places, then places dear enough.
 * Ties go to the more recent visit.
 */
export function favourites(
  affinity: PlaceAffinity,
  now: number,
): readonly FondPlace[] {
  return affinity.places
    .filter((place) => isLoved(place) || fondnessAt(place, now) >= FOND_AT)
    .toSorted(
      (a, b) =>
        Number(isLoved(b)) - Number(isLoved(a)) ||
        fondnessAt(b, now) - fondnessAt(a, now) ||
        b.lastAt - a.lastAt,
    );
}

/**
 * The dear place an idle Avaia most wants to go back to, within reach and on
 * open ground, if any longs enough and its return window has passed.
 */
export function placeToReturnTo(
  affinity: PlaceAffinity,
  from: MapPointSelection,
  reachMeters: number,
  now: number,
  open: (point: MapPointSelection) => boolean = () => true,
): FondPlace | undefined {
  let best: { place: FondPlace; want: number } | undefined;
  for (const place of affinity.places) {
    if (now - place.lastAt < returnAfterMs(affinity, place.id, now, Infinity)) {
      continue;
    }
    const want = longing(place, now);
    if (want < RETURN_LONGING) continue;
    if (mapDistanceMeters(from, place) > reachMeters || !open(place)) continue;
    if (
      best === undefined ||
      want > best.want ||
      (want === best.want && place.id < best.place.id)
    ) {
      best = { place, want };
    }
  }
  return best?.place;
}

/**
 * How much an outing target appeals, 0 to 1 before distance: a dear place by
 * how much it is longed for, a new one by how the temperament leans toward
 * its kind. Distance takes off up to a quarter over `maxMeters`.
 */
export function outingAppeal(
  affinity: PlaceAffinity,
  target: {
    readonly id: string;
    readonly kind: string;
    readonly meters: number;
  },
  now: number,
  maxMeters: number,
): number {
  const place = findPlace(affinity, target.id);
  const want =
    place === undefined
      ? 0.3 + 0.4 * temperament(affinity.by)[placeFamily(target.kind)]
      : 0.25 + 0.75 * longing(place, now);
  return want - 0.25 * Math.min(1, target.meters / Math.max(1, maxMeters));
}

/** Loved places stay; then the dearest; the rest are forgotten past the limit. */
function keepDearest(
  places: readonly FondPlace[],
  now: number,
): readonly FondPlace[] {
  if (places.length <= AFFINITY_LIMIT) return places;
  const keep = new Set(
    places
      .toSorted(
        (a, b) =>
          Number(isLoved(b)) - Number(isLoved(a)) ||
          fondnessAt(b, now) - fondnessAt(a, now) ||
          b.lastAt - a.lastAt,
      )
      .slice(0, AFFINITY_LIMIT)
      .map((place) => place.id),
  );
  return places.filter((place) => keep.has(place.id));
}

export interface AffinityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_PREFIX = "nilx-one.avaia.affinity.v1.";

function defaultStorage(): AffinityStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parsePlace(value: unknown): FondPlace | undefined {
  if (!isRecord(value)) return undefined;
  const { id, kind, name, longitude, latitude, fondness, visits } = value;
  const { firstAt, lastAt, lovedAt } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof kind !== "string" ||
    !finite(longitude) ||
    !finite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90 ||
    !finite(fondness) ||
    !finite(visits) ||
    visits < 1 ||
    !finite(firstAt) ||
    !finite(lastAt)
  ) {
    return undefined;
  }
  return {
    id,
    kind,
    ...(typeof name === "string" && name.length > 0 ? { name } : {}),
    longitude,
    latitude,
    fondness: clamp01(fondness),
    visits: Math.floor(visits),
    firstAt,
    lastAt,
    ...(finite(lovedAt) ? { lovedAt } : {}),
  };
}

/**
 * What this device remembers of one Bond's Avaia's feelings. A record kept for
 * another Avaia address is not this one's, and reads as empty. Never throws.
 */
export function readAffinity(
  owner: string,
  by: string,
  storage: AffinityStorage | undefined = defaultStorage(),
): PlaceAffinity {
  try {
    const raw = storage?.getItem(STORAGE_PREFIX + owner);
    if (raw === null || raw === undefined) return emptyAffinity(by);
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.by !== by) return emptyAffinity(by);
    const places = Array.isArray(parsed.places)
      ? parsed.places.flatMap((entry) => parsePlace(entry) ?? [])
      : [];
    const taste: Partial<Record<PlaceFamily, number>> = {};
    if (isRecord(parsed.taste)) {
      for (const family of PLACE_FAMILIES) {
        const value = parsed.taste[family];
        if (finite(value)) taste[family] = clamp01(value);
      }
    }
    return { by, places: places.slice(-AFFINITY_LIMIT), taste };
  } catch {
    return emptyAffinity(by);
  }
}

export function writeAffinity(
  owner: string,
  affinity: PlaceAffinity,
  storage: AffinityStorage | undefined = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_PREFIX + owner, JSON.stringify(affinity));
  } catch {
    // Remembering is best-effort: a full or blocked store forgets, it never breaks the world.
  }
}

// One record per Bond and Avaia for the whole page, read from storage once,
// the same way the landmark notebook is: a visit that ends is not a render.
const affinities = new Map<string, PlaceAffinity>();
const affinityListeners = new Set<() => void>();

function cacheKey(owner: string, by: string): string {
  return `${owner}\u0000${by}`;
}

export function affinitySnapshot(owner: string, by: string): PlaceAffinity {
  const cached = affinities.get(cacheKey(owner, by));
  if (cached !== undefined) return cached;
  const read = readAffinity(owner, by);
  affinities.set(cacheKey(owner, by), read);
  return read;
}

export function updateAffinity(
  owner: string,
  by: string,
  change: (affinity: PlaceAffinity) => PlaceAffinity,
): void {
  const current = affinitySnapshot(owner, by);
  const next = change(current);
  if (next === current) return;
  affinities.set(cacheKey(owner, by), next);
  writeAffinity(owner, next);
  for (const listener of [...affinityListeners]) listener();
}

export function subscribeAffinities(listener: () => void): () => void {
  affinityListeners.add(listener);
  return () => affinityListeners.delete(listener);
}

/** Forgets what was read, so the next snapshot reads storage again. */
export function forgetAffinityCache(): void {
  affinities.clear();
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    h = Math.imul(h ^ text.charCodeAt(index), 0x01000193);
  }
  return h >>> 0;
}

function mix(seed: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

function unit(value: number): number {
  return value / 0x1_0000_0000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
