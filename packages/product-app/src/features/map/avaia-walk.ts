// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  mapDistanceMeters,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * An Avaia walking across the world, the way a character in an isometric game
 * does: a person points at the ground, the body turns to face it and goes.
 *
 * It is presentation and nothing else. Where an Avaia stands is not observed,
 * not persisted, and never presence evidence: it is a body this device is
 * drawing, moved by a gesture on this device.
 */
export type AvaiaLocomotionMode = "walk" | "jog" | "run";

export interface AvaiaWalk {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  /**
   * The points the body turns at, `from` first and `to` last. A walk around
   * nothing is just the two of them.
   */
  readonly path: readonly MapPointSelection[];
  /** Ground distance from `from` to each point of `path`, in metres. */
  readonly along: readonly number[];
  readonly startedMs: number;
  readonly durationMs: number;
  /** Physical gait selected for this route before it sets off. */
  readonly mode: AvaiaLocomotionMode;
  /** Compass heading of the first leg, which is where the body sets off. */
  readonly bearingDeg: number;
  /** Compass heading of the last leg, which is how the body arrives. */
  readonly arrivalBearingDeg: number;
  /** Set when the walk is towards a landmark the Avaia means to study. */
  readonly landmark?: MapLandmark;
}

/** Where an Avaia is and what it is doing at one instant of a walk. */
export interface AvaiaStance {
  readonly point: MapPointSelection;
  readonly bearingDeg: number;
  readonly clipId: "walk" | "turn_in_place";
  readonly clipPhase: number;
}

/**
 * The length of the published `walk` clip (tools/avatars/rig.py). The clip is
 * in place, so the loop is driven here and one stride takes as long as the
 * asset authored it to.
 */
export const WALK_CLIP_MS = 1_200;

/** The published `turn_in_place` clip, played while studying a landmark. */
export const STUDY_CLIP_MS = 1_600;

/** How long an Avaia looks at a landmark before it says what it learned. */
export const STUDY_MS = STUDY_CLIP_MS * 2;

/**
 * Locomotion is physical world distance, never a screen-space effect.
 *
 * A close route is a walk. Past 400 m the body may settle into a jog, and a
 * long route may become a real run only when the route planner says the ground
 * supports it. Camera zoom never changes any of these speeds.
 */
export const WALK_SPEED_MPS = 1.4;
export const JOG_SPEED_MPS = 2.4;
export const RUN_SPEED_MPS = 3.6;

export const JOG_AFTER_METERS = 400;
export const RUN_AFTER_METERS = 1_200;

/**
 * The authored walk clip is reused at a gait-specific cadence. It remains
 * in-place; world translation is still measured in metres.
 */
export const JOG_CYCLE_MS = 900;
export const RUN_CYCLE_MS = 720;

/** Kept for callers that still use the old name. */
export const MIN_WALK_SPEED_MPS = WALK_SPEED_MPS;

/** A tap closer than this is a body turning on the spot, not a walk. */
export const MIN_WALK_METERS = 0.5;

const MODE_RANK: Readonly<Record<AvaiaLocomotionMode, number>> = {
  walk: 0,
  jog: 1,
  run: 2,
};

export function locomotionMode(
  meters: number,
  maxMode: AvaiaLocomotionMode,
): AvaiaLocomotionMode {
  if (
    meters > RUN_AFTER_METERS &&
    MODE_RANK[maxMode] >= MODE_RANK.run
  ) {
    return "run";
  }
  if (
    meters > JOG_AFTER_METERS &&
    MODE_RANK[maxMode] >= MODE_RANK.jog
  ) {
    return "jog";
  }
  return "walk";
}

export function locomotionSpeedMetersPerSecond(
  mode: AvaiaLocomotionMode,
): number {
  if (mode === "run") return RUN_SPEED_MPS;
  if (mode === "jog") return JOG_SPEED_MPS;
  return WALK_SPEED_MPS;
}

export function locomotionCycleMs(mode: AvaiaLocomotionMode): number {
  if (mode === "run") return RUN_CYCLE_MS;
  if (mode === "jog") return JOG_CYCLE_MS;
  return WALK_CLIP_MS;
}

/** Two footfalls land in each gait cycle. */
export function locomotionStepMs(mode: AvaiaLocomotionMode): number {
  return locomotionCycleMs(mode) / 2;
}

/**
 * Compatibility helper for code that asks specifically for walking speed.
 * Latitude and zoom are intentionally ignored.
 */
export function walkSpeedMetersPerSecond(
  _latitude: number,
  _zoom: number,
): number {
  return WALK_SPEED_MPS;
}

/**
 * A walk from `from` to `to`. Without a `path` it goes straight; with one, it
 * follows the route's turns, which must start at `from` and end at `to`.
 */
export function startWalk({
  from,
  to,
  path,
  nowMs,
  zoom,
  maxLocomotion = "walk",
  landmark,
}: {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  readonly path?: readonly MapPointSelection[] | undefined;
  readonly nowMs: number;
  readonly zoom: number;
  readonly maxLocomotion?: AvaiaLocomotionMode | undefined;
  readonly landmark?: MapLandmark | undefined;
}): AvaiaWalk {
  const points = (
    path !== undefined && path.length >= 2 ? path : [from, to]
  ).map((point) => ({ longitude: point.longitude, latitude: point.latitude }));
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(along[i - 1]! + mapDistanceMeters(points[i - 1]!, points[i]!));
  }
  const meters = along[along.length - 1]!;
  void from.latitude;
  void zoom;
  const mode = locomotionMode(meters, maxLocomotion);
  const speed = locomotionSpeedMetersPerSecond(mode);
  return {
    from: points[0]!,
    to: points[points.length - 1]!,
    path: points,
    along,
    startedMs: nowMs,
    durationMs: meters < MIN_WALK_METERS ? 0 : (meters / speed) * 1_000,
    mode,
    bearingDeg: legBearing(points, 0),
    arrivalBearingDeg: legBearing(points, points.length - 2),
    ...(landmark === undefined ? {} : { landmark }),
  };
}

function legBearing(points: readonly MapPointSelection[], leg: number): number {
  return mapCompassBearing(points[leg]!, points[leg + 1]!);
}

/** Which leg of its path a walk is on at `t` of the way, and how far along. */
function legAt(walk: AvaiaWalk, t: number): { leg: number; share: number } {
  const total = walk.along[walk.along.length - 1]!;
  const reached = total * t;
  let leg = 0;
  while (leg < walk.path.length - 2 && walk.along[leg + 1]! < reached) {
    leg += 1;
  }
  const length = walk.along[leg + 1]! - walk.along[leg]!;
  return {
    leg,
    share: length <= 0 ? 1 : (reached - walk.along[leg]!) / length,
  };
}

/** How far short of a landmark a body stops: in front of it, not inside it. */
export const LANDMARK_STAND_OFF_METERS = 4;

/** The point on the way to `to` that stops `standOff` metres before it. */
export function approachPoint(
  from: MapPointSelection,
  to: MapPointSelection,
  standOffMeters = LANDMARK_STAND_OFF_METERS,
): MapPointSelection {
  const meters = mapDistanceMeters(from, to);
  if (meters <= standOffMeters) {
    return { longitude: from.longitude, latitude: from.latitude };
  }
  const t = (meters - standOffMeters) / meters;
  return {
    longitude: from.longitude + (to.longitude - from.longitude) * t,
    latitude: from.latitude + (to.latitude - from.latitude) * t,
  };
}

/**
 * Picks the walk up from wherever the body is right now. A new tap mid-walk
 * turns the body where it stands, the way a click in a game re-targets rather
 * than finishing the old path first.
 */
export function walkPosition(
  walk: AvaiaWalk,
  nowMs: number,
): MapPointSelection {
  if (walk.durationMs <= 0) return walk.to;
  const t = walkProgress(walk, nowMs);
  if (t >= 1) return walk.to;
  const { leg, share } = legAt(walk, t);
  const a = walk.path[leg]!;
  const b = walk.path[leg + 1]!;
  // At walking distances a straight line in degrees is a straight line on the
  // ground to well under a centimetre, so no great-circle step is needed.
  return {
    longitude: a.longitude + (b.longitude - a.longitude) * share,
    latitude: a.latitude + (b.latitude - a.latitude) * share,
  };
}

function walkProgress(walk: AvaiaWalk, nowMs: number): number {
  if (walk.durationMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - walk.startedMs) / walk.durationMs));
}

/** Where the body faces at an instant: along whichever leg it is on. */
export function walkBearing(walk: AvaiaWalk, nowMs: number): number {
  const t = walkProgress(walk, nowMs);
  if (t >= 1) return walk.arrivalBearingDeg;
  return legBearing(walk.path, legAt(walk, t).leg);
}

export function walkArrived(walk: AvaiaWalk, nowMs: number): boolean {
  return nowMs - walk.startedMs >= walk.durationMs;
}

export function walkStance(walk: AvaiaWalk, nowMs: number): AvaiaStance {
  const since = Math.max(0, nowMs - walk.startedMs);
  return {
    point: walkPosition(walk, nowMs),
    bearingDeg: walkBearing(walk, nowMs),
    clipId: "walk",
    clipPhase:
      (since % locomotionCycleMs(walk.mode)) / locomotionCycleMs(walk.mode),
  };
}

/** An Avaia standing at a landmark, looking it over. */
export interface AvaiaStudy {
  readonly landmark: MapLandmark;
  readonly at: MapPointSelection;
  readonly bearingDeg: number;
  readonly startedMs: number;
}

export function studyStance(study: AvaiaStudy, nowMs: number): AvaiaStance {
  const since = Math.max(0, nowMs - study.startedMs);
  return {
    point: study.at,
    bearingDeg: study.bearingDeg,
    clipId: "turn_in_place",
    clipPhase: (since % STUDY_CLIP_MS) / STUDY_CLIP_MS,
  };
}

export function studyFinished(study: AvaiaStudy, nowMs: number): boolean {
  return nowMs - study.startedMs >= STUDY_MS;
}
