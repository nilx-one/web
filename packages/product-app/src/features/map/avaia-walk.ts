// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  mapDistanceMeters,
  mapMetersPerPixel,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";

import { AVATAR_APPARENT_PIXELS } from "./avatar-presence";

/**
 * An Avaia walking across the world, the way a character in an isometric game
 * does: a person points at the ground, the body turns to face it and goes.
 *
 * It is presentation and nothing else. Where an Avaia stands is not observed,
 * not persisted, and never presence evidence: it is a body this device is
 * drawing, moved by a gesture on this device.
 */
export interface AvaiaWalk {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  readonly startedMs: number;
  readonly durationMs: number;
  /** Compass heading from `from` to `to`, which is where the body faces. */
  readonly bearingDeg: number;
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
 * How far a body goes per second, in its own drawn heights. A body is drawn at
 * one apparent size at every scale, so a pace measured in metres would crawl
 * at street scale and teleport at building scale; a pace measured against the
 * body reads the same wherever the camera is, which is what a character in a
 * game does.
 */
export const WALK_BODY_HEIGHTS_PER_SECOND = 1.1;

/** Nobody walks slower than a stroll, even a body drawn very small. */
export const MIN_WALK_SPEED_MPS = 1.4;

/** A tap closer than this is a body turning on the spot, not a walk. */
export const MIN_WALK_METERS = 0.5;

/** The ground speed a walk started at this scale moves at. */
export function walkSpeedMetersPerSecond(
  latitude: number,
  zoom: number,
): number {
  const bodyMeters = AVATAR_APPARENT_PIXELS * mapMetersPerPixel(latitude, zoom);
  const speed = bodyMeters * WALK_BODY_HEIGHTS_PER_SECOND;
  return Number.isFinite(speed)
    ? Math.max(MIN_WALK_SPEED_MPS, speed)
    : MIN_WALK_SPEED_MPS;
}

export function startWalk({
  from,
  to,
  nowMs,
  zoom,
  landmark,
}: {
  readonly from: MapPointSelection;
  readonly to: MapPointSelection;
  readonly nowMs: number;
  readonly zoom: number;
  readonly landmark?: MapLandmark | undefined;
}): AvaiaWalk {
  const meters = mapDistanceMeters(from, to);
  const speed = walkSpeedMetersPerSecond(from.latitude, zoom);
  return {
    from: { longitude: from.longitude, latitude: from.latitude },
    to: { longitude: to.longitude, latitude: to.latitude },
    startedMs: nowMs,
    durationMs: meters < MIN_WALK_METERS ? 0 : (meters / speed) * 1_000,
    bearingDeg: mapCompassBearing(from, to),
    ...(landmark === undefined ? {} : { landmark }),
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
  const t = Math.min(
    1,
    Math.max(0, (nowMs - walk.startedMs) / walk.durationMs),
  );
  // At walking distances a straight line in degrees is a straight line on the
  // ground to well under a centimetre, so no great-circle step is needed.
  return {
    longitude:
      walk.from.longitude + (walk.to.longitude - walk.from.longitude) * t,
    latitude: walk.from.latitude + (walk.to.latitude - walk.from.latitude) * t,
  };
}

export function walkArrived(walk: AvaiaWalk, nowMs: number): boolean {
  return nowMs - walk.startedMs >= walk.durationMs;
}

export function walkStance(walk: AvaiaWalk, nowMs: number): AvaiaStance {
  const since = Math.max(0, nowMs - walk.startedMs);
  return {
    point: walkPosition(walk, nowMs),
    bearingDeg: walk.bearingDeg,
    clipId: "walk",
    clipPhase: (since % WALK_CLIP_MS) / WALK_CLIP_MS,
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
