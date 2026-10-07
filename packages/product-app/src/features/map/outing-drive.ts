// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  distanceM,
  type LonLat,
  type Reach,
  type WalkGraph,
} from "@nilx-one/walk-graph";

import {
  chooseByRule,
  NEAR_METERS,
  type OutingMenu,
  type OutingOption,
  type OutingTarget,
} from "./outing-targets";
import {
  outingAppeal,
  returnAfterMs,
  type PlaceAffinity,
} from "./place-affinity";

/**
 * The Avaia's drive: when it goes out on its own, how far, and where to
 * (docs/avaia-outings.md §2, #302).
 *
 * A pure state machine. The walk hook feeds it what happened — a tap, a walk
 * setting off or arriving, time passing — and asks it what to do next. What
 * the Avaia does is decided here, in code; a model only ever picks from the
 * menu `outingMenu` built, never a place of its own.
 *
 * Nothing here is observed, persisted beyond this device, or sent. An outing
 * is never presence evidence and never a BondChain record, and it never
 * moves the camera.
 */

/** No two outings closer together than this. */
export const OUTING_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** How long an Avaia stands idle before it gets restless enough to go out. */
export const RESTLESS_MS = 10 * 60 * 1000;

/** How long it stands at a tapped point B, looking around, before it carries on. */
export const POINT_B_STAND_MS = 20_000;

/** How long it looks around a target it walked out to. */
export const VISIT_MS = 30_000;

/** Energy, 0 to 1, spent for each kilometre walked: a full charge is 5 km. */
export const ENERGY_PER_KM = 0.2;

/** Below this an Avaia away from home goes home rather than further out. */
export const LOW_ENERGY = 0.3;

/** Within this of home it is home. */
export const HOME_RADIUS_METERS = 50;

/** A target visited this recently is left off the menu. */
export const REVISIT_MS = 7 * 24 * 60 * 60 * 1000;

/** A wander goes this far, along the paths. */
export const WANDER_MIN_METERS = 150;
export const WANDER_MAX_METERS = 400;

/** An outing never plans further than this, however rested the Avaia is. */
export const MAX_OUTING_METERS = 3_000;

/**
 * How long a settled Avaia stands before it strolls about on its own: after a
 * stand at point B, a visit, a study. Each stroll in a row doubles the wait,
 * up to `STROLL_MAX_IDLE_MS`, so it potters less the longer it potters.
 */
export const STROLL_IDLE_MS = 30_000;
export const STROLL_MAX_IDLE_MS = 5 * 60 * 1000;

/** A stroll goes this far along the paths: a few steps, not an outing. */
export const STROLL_MIN_METERS = 30;
export const STROLL_MAX_METERS = 120;

/** A stroll never takes the Avaia further than this from where it settled. */
export const STROLL_LEASH_METERS = 200;

/** How long it looks around where a stroll took it. */
export const STROLL_LOOK_MS = 8_000;

/** What a walk is for. A tap is the owner pointing; the rest are the drive's. */
export type WalkPurpose =
  "tap" | "curiosity" | "outing" | "wander" | "home" | "stroll";

export type DriveActivity =
  | { readonly kind: "idle"; readonly since: number }
  | {
      readonly kind: "walking";
      readonly purpose: WalkPurpose;
      readonly targetId?: string;
      readonly since: number;
    }
  | {
      readonly kind: "standing";
      readonly reason: "point_b" | "visit" | "look";
      readonly until: number;
    };

export interface DriveState {
  readonly activity: DriveActivity;
  /**
   * When the Avaia last settled after something it set out to do: a walk
   * arrived, a stand or a visit over. Strolling about does not settle it, so
   * restlessness keeps growing while it potters.
   */
  readonly settledAt: number;
  /** Strolls since it last settled; each one makes the next wait longer. */
  readonly strolls: number;
  /** 0 to 1. */
  readonly energy: number;
  /** When the last outing was decided, whatever it turned out to be. */
  readonly lastOutingAt: number | null;
  /** Target id to when it was last visited. */
  readonly visited: Readonly<Record<string, number>>;
}

export type DriveEvent =
  /** The owner tapped somewhere and the Avaia set off: always wins. */
  | { readonly type: "tap"; readonly at: number }
  /** A walk the drive chose set off. */
  | {
      readonly type: "set_off";
      readonly at: number;
      readonly purpose: Exclude<WalkPurpose, "tap">;
      readonly targetId?: string;
    }
  /** The drive was asked and chose to stay. */
  | { readonly type: "stayed"; readonly at: number }
  /** A stroll was due but found nowhere to go: it waits for the next one. */
  | { readonly type: "lingered"; readonly at: number }
  /**
   * The walk under way arrived, `meters` after it set off. A visit lasts
   * `stayMs` when the place says how long, `VISIT_MS` otherwise.
   */
  | {
      readonly type: "arrived";
      readonly at: number;
      readonly meters: number;
      readonly stayMs?: number;
    }
  /**
   * Whatever the Avaia was doing ended early: a walk that did not arrive, or a
   * stand cut short because it left the wheel.
   */
  | { readonly type: "stopped"; readonly at: number }
  | { readonly type: "tick"; readonly at: number };

export function initialDrive(
  now: number,
  lastOutingAt: number | null = null,
): DriveState {
  return {
    activity: { kind: "idle", since: now },
    settledAt: now,
    strolls: 0,
    energy: 1,
    lastOutingAt,
    visited: {},
  };
}

/**
 * One transition. Every pair of state and event has a defined answer:
 *
 * - a tap, in any state, starts a tap walk from wherever the body is;
 * - a drive walk sets off only from idle: it never cuts short a walk, a stand
 *   at point B, or a visit;
 * - arriving at a tapped point B stands there `POINT_B_STAND_MS`, then idles
 *   there: autonomy carries on from B, not from home;
 * - arriving at a target looks around it for `VISIT_MS`; arriving home
 *   recharges; a stroll looks around for `STROLL_LOOK_MS`; arriving anywhere
 *   else idles there;
 * - a walk or a stand cut short idles where the body is;
 * - whatever ends in idle settles the Avaia there, unless it was a stroll
 *   that arrived or the look around after one: pottering about is not
 *   settling, being stopped is.
 */
export function stepDrive(state: DriveState, event: DriveEvent): DriveState {
  const { activity } = state;
  switch (event.type) {
    case "tap":
      return {
        ...state,
        activity: { kind: "walking", purpose: "tap", since: event.at },
      };
    case "set_off": {
      if (activity.kind !== "idle") return state;
      const outing =
        event.purpose !== "curiosity" && event.purpose !== "stroll";
      return {
        ...state,
        strolls: event.purpose === "stroll" ? state.strolls + 1 : state.strolls,
        activity: {
          kind: "walking",
          purpose: event.purpose,
          since: event.at,
          ...(event.targetId === undefined ? {} : { targetId: event.targetId }),
        },
        lastOutingAt: outing ? event.at : state.lastOutingAt,
      };
    }
    case "stayed":
      return activity.kind === "idle"
        ? {
            ...state,
            activity: { kind: "idle", since: event.at },
            lastOutingAt: event.at,
          }
        : state;
    case "lingered":
      return activity.kind === "idle"
        ? {
            ...state,
            activity: { kind: "idle", since: event.at },
            strolls: state.strolls + 1,
          }
        : state;
    case "arrived": {
      if (activity.kind !== "walking") return state;
      const spent = Math.max(0, event.meters / 1000) * ENERGY_PER_KM;
      const energy = clamp01(state.energy - spent);
      switch (activity.purpose) {
        case "stroll":
          return {
            ...state,
            energy,
            activity: {
              kind: "standing",
              reason: "look",
              until: event.at + STROLL_LOOK_MS,
            },
          };
        case "tap":
          return {
            ...state,
            energy,
            activity: {
              kind: "standing",
              reason: "point_b",
              until: event.at + POINT_B_STAND_MS,
            },
          };
        case "outing":
          return {
            ...state,
            energy,
            activity: {
              kind: "standing",
              reason: "visit",
              until: event.at + (event.stayMs ?? VISIT_MS),
            },
            visited:
              activity.targetId === undefined
                ? state.visited
                : { ...state.visited, [activity.targetId]: event.at },
          };
        case "home":
          return settle(
            { ...state, energy: 1 },
            { kind: "idle", since: event.at },
          );
        default:
          return settle(
            { ...state, energy },
            { kind: "idle", since: event.at },
          );
      }
    }
    case "stopped":
      return activity.kind === "idle"
        ? state
        : settle(state, { kind: "idle", since: event.at });
    case "tick":
      if (activity.kind !== "standing" || event.at < activity.until) {
        return state;
      }
      return pottering(activity)
        ? { ...state, activity: { kind: "idle", since: activity.until } }
        : settle(state, { kind: "idle", since: activity.until });
  }
}

/** Whether the Avaia is only strolling about, or looking around after it. */
function pottering(activity: DriveActivity): boolean {
  return (
    (activity.kind === "walking" && activity.purpose === "stroll") ||
    (activity.kind === "standing" && activity.reason === "look")
  );
}

/** Idle where it is, settled: restlessness and strolls start over. */
function settle(
  state: DriveState,
  idle: Extract<DriveActivity, { kind: "idle" }>,
): DriveState {
  return { ...state, activity: idle, settledAt: idle.since, strolls: 0 };
}

/**
 * 0 while doing anything; climbs to 1 over `RESTLESS_MS` since it settled.
 * Strolling about does not calm it: it is restless all the same.
 */
export function restlessness(state: DriveState, now: number): number {
  if (state.activity.kind !== "idle" && !pottering(state.activity)) return 0;
  return clamp01((now - state.settledAt) / RESTLESS_MS);
}

/**
 * When the drive next wants to go out, or `null` while the Avaia is busy.
 * Restless enough, and the interval since the last outing passed.
 */
export function nextOutingAt(state: DriveState): number | null {
  if (state.activity.kind !== "idle") return null;
  const restless = state.settledAt + RESTLESS_MS;
  const rested =
    state.lastOutingAt === null
      ? -Infinity
      : state.lastOutingAt + OUTING_INTERVAL_MS;
  return Math.max(restless, rested);
}

/**
 * When an idle Avaia next strolls about on its own, or `null` when it will
 * not: busy, too tired, or an outing due first. A stroll is not an outing: it
 * goes a few steps and back to standing, never touches the interval between
 * outings, and keeps the Avaia from freezing in place between them. Each
 * stroll in a row waits twice as long as the one before, up to
 * `STROLL_MAX_IDLE_MS`, and twice as long again in the evening and at night
 * (20:00 to 07:00 local).
 */
export function nextStrollAt(state: DriveState, hour: number): number | null {
  const { activity } = state;
  if (activity.kind !== "idle" || state.energy < LOW_ENERGY) return null;
  const evening = hour >= 20 || hour < 7;
  const wait =
    Math.min(STROLL_MAX_IDLE_MS, STROLL_IDLE_MS * 2 ** state.strolls) *
    (evening ? 2 : 1);
  const at = activity.since + wait;
  const outing = nextOutingAt(state);
  return outing !== null && outing <= at ? null : at;
}

/** How far out an outing may plan: a there-and-back on what energy is left. */
export function outingBudgetMeters(state: DriveState): number {
  return Math.min(
    MAX_OUTING_METERS,
    ((state.energy / ENERGY_PER_KM) * 1000) / 2,
  );
}

/**
 * Targets visited too recently to go back to. A week for most; with the
 * Avaia's feelings at hand, a day for a place it loves and three for a
 * favourite, and what it remembers visiting counts as well as this page's.
 */
export function recentlyVisited(
  state: DriveState,
  now: number,
  affinity?: PlaceAffinity,
): ReadonlySet<string> {
  const last = new Map(Object.entries(state.visited));
  for (const place of affinity?.places ?? []) {
    last.set(place.id, Math.max(last.get(place.id) ?? -Infinity, place.lastAt));
  }
  return new Set(
    [...last]
      .filter(
        ([id, at]) =>
          now - at <
          (affinity === undefined
            ? REVISIT_MS
            : returnAfterMs(affinity, id, REVISIT_MS)),
      )
      .map(([id]) => id),
  );
}

export type OutingChoice = OutingOption | { readonly kind: "home" };

/**
 * The drive's own pick from a menu, the weights a model never sees:
 *
 * - tired and away from home: go home;
 * - evening and night (20:00 to 07:00 local): only a near target, else wander;
 * - otherwise the nearest target (the menu's rule), else wander, else stay.
 *
 * With the Avaia's feelings at hand, "nearest" becomes "most wanted": a place
 * it longs for, or a new one its temperament leans toward, wins over one a
 * little closer. Distance still counts against it.
 */
export function chooseOuting(
  state: DriveState,
  menu: OutingMenu,
  context: {
    readonly at: LonLat;
    readonly home: LonLat | undefined;
    readonly hour: number;
    readonly affinity?: PlaceAffinity | undefined;
    /** Wall-clock milliseconds, for how feelings stand now. */
    readonly now?: number | undefined;
  },
): OutingChoice {
  if (
    state.energy < LOW_ENERGY &&
    context.home !== undefined &&
    distanceM(context.at, context.home) > HOME_RADIUS_METERS
  ) {
    return { kind: "home" };
  }
  const evening = context.hour >= 20 || context.hour < 7;
  const targets = menu.options.flatMap((option) =>
    option.kind === "target" &&
    (!evening || option.target.meters <= NEAR_METERS)
      ? [option.target]
      : [],
  );
  const { affinity } = context;
  if (affinity !== undefined && targets.length > 0) {
    const now = context.now ?? Date.now();
    const wanted = mostWanted(
      targets,
      affinity,
      now,
      outingBudgetMeters(state),
    );
    return { kind: "target", target: wanted };
  }
  if (evening) {
    const near = targets[0];
    return near !== undefined
      ? { kind: "target", target: near }
      : (menu.options.find((option) => option.kind === "wander") ?? {
          kind: "stay",
        });
  }
  return chooseByRule(menu);
}

/** The target that appeals most; the nearer one when two appeal the same. */
function mostWanted(
  targets: readonly OutingTarget[],
  affinity: PlaceAffinity,
  now: number,
  maxMeters: number,
): OutingTarget {
  let best = targets[0]!;
  let bestAppeal = outingAppeal(affinity, best, now, maxMeters);
  for (const target of targets.slice(1)) {
    const appeal = outingAppeal(affinity, target, now, maxMeters);
    if (appeal > bestAppeal) {
      best = target;
      bestAppeal = appeal;
    }
  }
  return best;
}

/**
 * Where a wander goes: a graph node `WANDER_MIN_METERS` to
 * `WANDER_MAX_METERS` away along the paths, picked by `seed`. The same graph,
 * reach and seed pick the same node.
 */
export function wanderPoint(
  graph: WalkGraph,
  reach: Reach,
  seed: number,
): LonLat | undefined {
  const candidates: number[] = [];
  for (let node = 0; node < graph.nodes.length; node++) {
    const meters = reach.lengthM[node]!;
    if (meters >= WANDER_MIN_METERS && meters <= WANDER_MAX_METERS) {
      candidates.push(node);
    }
  }
  if (candidates.length === 0) return undefined;
  return graph.nodes[candidates[mix(seed) % candidates.length]!];
}

/**
 * Where a stroll goes: a graph node `STROLL_MIN_METERS` to
 * `STROLL_MAX_METERS` away along the paths that is still within
 * `STROLL_LEASH_METERS` of where the Avaia settled, picked by `seed`. The
 * same graph, reach, anchor and seed pick the same node.
 */
export function strollPoint(
  graph: WalkGraph,
  reach: Reach,
  anchor: LonLat,
  seed: number,
): LonLat | undefined {
  const candidates: number[] = [];
  for (let node = 0; node < graph.nodes.length; node++) {
    const meters = reach.lengthM[node]!;
    if (
      meters >= STROLL_MIN_METERS &&
      meters <= STROLL_MAX_METERS &&
      distanceM(graph.nodes[node]!, anchor) <= STROLL_LEASH_METERS
    ) {
      candidates.push(node);
    }
  }
  if (candidates.length === 0) return undefined;
  return graph.nodes[candidates[mix(seed) % candidates.length]!];
}

/**
 * The way back to the paths for an Avaia left off them, on the grass of a
 * point B say: the nearest graph node within `STROLL_MAX_METERS`, or
 * `undefined` when none is. An Avaia on its own keeps to the paths, so with
 * none in reach it stays where it is rather than roam the grass.
 */
export function strollBack(
  graph: WalkGraph,
  from: LonLat,
  canEnter?: (point: LonLat) => boolean,
): LonLat | undefined {
  let best: LonLat | undefined;
  let bestMeters = STROLL_MAX_METERS;
  for (const node of graph.nodes) {
    const meters = distanceM(node, from);
    if (meters <= bestMeters && (canEnter?.(node) ?? true)) {
      best = node;
      bestMeters = meters;
    }
  }
  return best;
}

/** The seed for the stroll the drive is at: one per settling and stroll. */
export function strollSeed(state: DriveState): number {
  return Math.floor(state.settledAt / 1000) + state.strolls;
}

/** The seed for a wander decided at `now`: one per outing window. */
export function wanderSeed(now: number): number {
  return Math.floor(now / OUTING_INTERVAL_MS);
}

function mix(seed: number): number {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b;
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35);
  return (h ^ (h >>> 13)) >>> 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
