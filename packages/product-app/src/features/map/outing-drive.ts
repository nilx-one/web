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
} from "./outing-targets";

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

/** What a walk is for. A tap is the owner pointing; the rest are the drive's. */
export type WalkPurpose = "tap" | "curiosity" | "outing" | "wander" | "home";

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
      readonly reason: "point_b" | "visit";
      readonly until: number;
    };

export interface DriveState {
  readonly activity: DriveActivity;
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
  /** The walk under way arrived, `meters` after it set off. */
  | { readonly type: "arrived"; readonly at: number; readonly meters: number }
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
 *   recharges; arriving anywhere else idles there;
 * - a walk or a stand cut short idles where the body is.
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
      const outing = event.purpose !== "curiosity";
      return {
        ...state,
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
    case "arrived": {
      if (activity.kind !== "walking") return state;
      const spent = Math.max(0, event.meters / 1000) * ENERGY_PER_KM;
      const energy = clamp01(state.energy - spent);
      switch (activity.purpose) {
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
              until: event.at + VISIT_MS,
            },
            visited:
              activity.targetId === undefined
                ? state.visited
                : { ...state.visited, [activity.targetId]: event.at },
          };
        case "home":
          return {
            ...state,
            energy: 1,
            activity: { kind: "idle", since: event.at },
          };
        default:
          return {
            ...state,
            energy,
            activity: { kind: "idle", since: event.at },
          };
      }
    }
    case "stopped":
      return activity.kind === "idle"
        ? state
        : { ...state, activity: { kind: "idle", since: event.at } };
    case "tick":
      return activity.kind === "standing" && event.at >= activity.until
        ? { ...state, activity: { kind: "idle", since: activity.until } }
        : state;
  }
}

/** 0 while doing anything; climbs to 1 over `RESTLESS_MS` of standing idle. */
export function restlessness(state: DriveState, now: number): number {
  if (state.activity.kind !== "idle") return 0;
  return clamp01((now - state.activity.since) / RESTLESS_MS);
}

/**
 * When the drive next wants to go out, or `null` while the Avaia is busy.
 * Restless enough, and the interval since the last outing passed.
 */
export function nextOutingAt(state: DriveState): number | null {
  if (state.activity.kind !== "idle") return null;
  const restless = state.activity.since + RESTLESS_MS;
  const rested =
    state.lastOutingAt === null
      ? -Infinity
      : state.lastOutingAt + OUTING_INTERVAL_MS;
  return Math.max(restless, rested);
}

/** How far out an outing may plan: a there-and-back on what energy is left. */
export function outingBudgetMeters(state: DriveState): number {
  return Math.min(
    MAX_OUTING_METERS,
    ((state.energy / ENERGY_PER_KM) * 1000) / 2,
  );
}

/** Targets visited too recently to go back to. */
export function recentlyVisited(
  state: DriveState,
  now: number,
): ReadonlySet<string> {
  return new Set(
    Object.entries(state.visited)
      .filter(([, at]) => now - at < REVISIT_MS)
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
 */
export function chooseOuting(
  state: DriveState,
  menu: OutingMenu,
  context: {
    readonly at: LonLat;
    readonly home: LonLat | undefined;
    readonly hour: number;
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
  if (evening) {
    const near = menu.options.find(
      (option) =>
        option.kind === "target" && option.target.meters <= NEAR_METERS,
    );
    return (
      near ??
      menu.options.find((option) => option.kind === "wander") ?? {
        kind: "stay",
      }
    );
  }
  return chooseByRule(menu);
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
