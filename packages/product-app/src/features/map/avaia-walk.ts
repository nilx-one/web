// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  mapDistanceMeters,
  type AvatarModelId,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";

import GAIT from "./avatar-gait.json";

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
 * The length the published `walk` clip was authored at (tools/avatars/rig.py).
 * The clip is in place, so the loop is driven here, at whatever stride the
 * body's own legs and speed call for rather than at this length.
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
 * Steps a minute that a person with the reference body's legs settles into at
 * each gait's speed: an unhurried walk, an easy jog, a steady run. The
 * reference is the shortest study, the one every body is measured against.
 */
export const WALK_CADENCE_SPM = 120;
export const JOG_CADENCE_SPM = 165;
export const RUN_CADENCE_SPM = 180;

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
  if (meters > RUN_AFTER_METERS && MODE_RANK[maxMode] >= MODE_RANK.run) {
    return "run";
  }
  if (meters > JOG_AFTER_METERS && MODE_RANK[maxMode] >= MODE_RANK.jog) {
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

/** A study's legs as the published rig moves them: measured, never tuned. */
export interface AvatarGait {
  /** Standing, from the ground to the hip joint. */
  readonly legMeters: number;
  /** Ground one foot sweeps under the hips in one step of the walk clip. */
  readonly stepMeters: number;
}

/**
 * Each published study's legs, measured from its own walk clip by forward
 * kinematics. tools/avatars/test_rig.py measures the built assets again and
 * fails if these drift, so a rebuilt body never walks on another body's legs.
 */
export const AVATAR_GAIT: Readonly<Record<AvatarModelId, AvatarGait>> =
  GAIT.studies;

/** The legs every body is measured against: the 1.8 m study. */
const REFERENCE_GAIT = AVATAR_GAIT["dasha-study"];

/**
 * Where in the walk clip each foot lands, as a share of the stride: the right
 * foot reaches furthest forward at a quarter, the left at three quarters.
 */
export const FOOTFALL_PHASES: readonly number[] = GAIT.footfallPhases;

function locomotionCadenceSpm(mode: AvaiaLocomotionMode): number {
  if (mode === "run") return RUN_CADENCE_SPM;
  if (mode === "jog") return JOG_CADENCE_SPM;
  return WALK_CADENCE_SPM;
}

/**
 * How long one full stride (two footfalls) takes a body with these legs.
 *
 * A planted foot stays planted when each step covers exactly the ground the
 * clip sweeps under the hips, so that is the stride a body would take. Legs
 * swing like pendulums, though: the cadence a person settles into falls with
 * the square root of leg length, and no stride is quicker than that. Where a
 * clip's legs cannot cover the ground at a human cadence, the feet give up
 * the difference as slip rather than the body scurrying to keep them planted.
 */
export function gaitCycleMs(
  mode: AvaiaLocomotionMode,
  gait: AvatarGait,
): number {
  const speed = locomotionSpeedMetersPerSecond(mode);
  const planted = ((2 * gait.stepMeters) / speed) * 1_000;
  const cadence =
    locomotionCadenceSpm(mode) *
    Math.sqrt(REFERENCE_GAIT.legMeters / gait.legMeters);
  return Math.max(planted, (2 * 60_000) / cadence);
}

/**
 * How much faster the ground moves under a body than its planted foot does:
 * 1 is a foot that stays where it landed, 2 is one that skates half its step.
 */
export function gaitFootSlip(
  mode: AvaiaLocomotionMode,
  gait: AvatarGait,
): number {
  const strideMeters =
    locomotionSpeedMetersPerSecond(mode) * (gaitCycleMs(mode, gait) / 1_000);
  return strideMeters / (2 * gait.stepMeters);
}

/** The stride of the reference body, for callers that draw no study. */
export function locomotionCycleMs(mode: AvaiaLocomotionMode): number {
  return gaitCycleMs(mode, REFERENCE_GAIT);
}

/** Two footfalls land in each gait cycle. */
export function locomotionStepMs(mode: AvaiaLocomotionMode): number {
  return locomotionCycleMs(mode) / 2;
}

/**
 * A study walks on its own legs. The route speed stays what the gait says; how
 * often the feet land is the body's.
 */
export function avatarLocomotionCycleMs(
  mode: AvaiaLocomotionMode,
  model: AvatarModelId | undefined,
): number {
  return gaitCycleMs(
    mode,
    model === undefined ? REFERENCE_GAIT : AVATAR_GAIT[model],
  );
}

export function avatarLocomotionStepMs(
  mode: AvaiaLocomotionMode,
  model: AvatarModelId | undefined,
): number {
  return avatarLocomotionCycleMs(mode, model) / 2;
}

/**
 * How long from `nowMs` until this walk's next foot lands, so a footfall is
 * heard when a foot is seen to land rather than on a clock of its own.
 */
export function nextFootfallMs(
  walk: AvaiaWalk,
  nowMs: number,
  model?: AvatarModelId,
): number {
  const cycleMs = avatarLocomotionCycleMs(walk.mode, model);
  const phase = (Math.max(0, nowMs - walk.startedMs) % cycleMs) / cycleMs;
  // A foot that has just landed is not landing again: a timer that fires on
  // the footfall it was set for must find the next one.
  const next =
    FOOTFALL_PHASES.find((landing) => landing - phase > 1e-3) ??
    FOOTFALL_PHASES[0]! + 1;
  return (next - phase) * cycleMs;
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

/**
 * The part of a walk the body has actually walked by `nowMs`, as a walk of its
 * own from `from` to where the body is, or `undefined` when it has not got
 * anywhere yet. What is still ahead is never in it.
 */
export function walkedSoFar(
  walk: AvaiaWalk,
  nowMs: number,
): AvaiaWalk | undefined {
  const t = walkProgress(walk, nowMs);
  const total = walk.along[walk.along.length - 1] ?? 0;
  const reached = total * t;
  if (reached < MIN_WALK_METERS) return undefined;
  if (t >= 1) return walk;
  const at = walkPosition(walk, nowMs);
  const path = [
    ...walk.path.filter((_, index) => (walk.along[index] ?? 0) < reached),
    at,
  ];
  const along = [...walk.along.filter((meters) => meters < reached), reached];
  return {
    ...walk,
    to: at,
    path,
    along,
    durationMs: walk.durationMs * t,
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

export function walkStance(
  walk: AvaiaWalk,
  nowMs: number,
  model?: AvatarModelId,
): AvaiaStance {
  const since = Math.max(0, nowMs - walk.startedMs);
  const cycleMs = avatarLocomotionCycleMs(walk.mode, model);
  return {
    point: walkPosition(walk, nowMs),
    bearingDeg: walkBearing(walk, nowMs),
    clipId: "walk",
    clipPhase: (since % cycleMs) / cycleMs,
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
