// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  type AvatarClipId,
  type AvatarModelId,
  type MapCamera,
  type MapCameraPadding,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * Where a scene with 0xda-sha is staged, and how the camera frames it.
 *
 * All of it is presentation. She is drawn beside the body this device already
 * draws, at the one place this client observed — never at a place she claims
 * to be, never as evidence that anyone is anywhere, and never written back.
 */

/** She stands just in front of the Bond's body, which faces north. */
export const GUIDE_STAND_METERS = 2.2;
/** And walks up to it from a little way off, from the north-north-east. */
export const GUIDE_ENTRY_METERS = 14;
export const GUIDE_ENTRY_BEARING = 20;

/** Long enough to read as walking up to someone rather than sliding in. */
export const GUIDE_WALK_MS = 4_200;
export const GUIDE_LEAVE_MS = 2_400;
export const GUIDE_WALK_CLIP_MS = 1_200;
export const GUIDE_GESTURE_MS = 2_000;
/** Standing still is still a loop: breathing, a shift of weight. */
export const GUIDE_IDLE_CLIP_MS = 8_000;

/**
 * The published styles cap pitch at sixty degrees; a shot never asks for more
 * than the camera a person can reach themselves.
 */
export const GUIDE_MAX_PITCH = 60;

export type GuideShot = "establish" | "two-shot" | "dasha" | "you" | "reward";

export interface GuideStage {
  /** The Bond's body: where this device observed itself. */
  readonly you: MapPointSelection;
  /** Where she stands while she talks. */
  readonly dasha: MapPointSelection;
  /** Where she walks in from, and back to. */
  readonly entry: MapPointSelection;
}

const METERS_PER_DEGREE_LATITUDE = 111_320;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** A point a short walk away. Flat-earth is exact enough at a few metres. */
export function offsetPoint(
  from: MapPointSelection,
  bearingDeg: number,
  meters: number,
): MapPointSelection {
  const north = Math.cos(radians(bearingDeg)) * meters;
  const east = Math.sin(radians(bearingDeg)) * meters;
  return {
    latitude: from.latitude + north / METERS_PER_DEGREE_LATITUDE,
    longitude:
      from.longitude +
      east / (METERS_PER_DEGREE_LATITUDE * Math.cos(radians(from.latitude))),
  };
}

export function lerpPoint(
  from: MapPointSelection,
  to: MapPointSelection,
  t: number,
): MapPointSelection {
  return {
    longitude: from.longitude + (to.longitude - from.longitude) * t,
    latitude: from.latitude + (to.latitude - from.latitude) * t,
  };
}

export function guideStage(you: MapPointSelection): GuideStage {
  return {
    you: { longitude: you.longitude, latitude: you.latitude },
    dasha: offsetPoint(you, 0, GUIDE_STAND_METERS),
    entry: offsetPoint(you, GUIDE_ENTRY_BEARING, GUIDE_ENTRY_METERS),
  };
}

interface ShotFrame {
  /** How far from the Bond towards her the camera centres, 0 to 1. */
  readonly focus: number;
  readonly zoom: number;
  readonly pitch: number;
  /** The way the camera looks. Behind the Bond is north; behind her, south. */
  readonly bearing: number;
}

/**
 * Shot, reverse shot. Whoever is speaking is looked at over the other's
 * shoulder, and a line said to both is framed from the side.
 */
const SHOTS: Readonly<Record<Exclude<GuideShot, "establish">, ShotFrame>> = {
  "two-shot": { focus: 0.5, zoom: 21.2, pitch: 56, bearing: 96 },
  dasha: { focus: 0.7, zoom: 21.9, pitch: 60, bearing: 16 },
  you: { focus: 0.3, zoom: 21.9, pitch: 60, bearing: 196 },
  reward: { focus: 0.85, zoom: 21.5, pitch: 48, bearing: 332 },
};

export function guideShotCamera(shot: GuideShot, stage: GuideStage): MapCamera {
  if (shot === "establish") {
    // Over the Bond's shoulder, wide enough to see her coming.
    const center = lerpPoint(stage.you, stage.entry, 0.5);
    return {
      center: [center.longitude, center.latitude],
      zoom: 19.4,
      pitch: 52,
      bearing: GUIDE_ENTRY_BEARING,
    };
  }
  const frame = SHOTS[shot];
  const center = lerpPoint(stage.you, stage.dasha, frame.focus);
  return {
    center: [center.longitude, center.latitude],
    zoom: frame.zoom,
    pitch: Math.min(GUIDE_MAX_PITCH, frame.pitch),
    bearing: frame.bearing,
  };
}

/** A held shot keeps breathing: a slow creep sideways and in. */
export function driftCamera(camera: MapCamera): MapCamera {
  return {
    ...camera,
    bearing: camera.bearing + 7,
    zoom: camera.zoom + 0.15,
  };
}

/**
 * The subtitles sit low on the screen, so a shot frames its subjects in the
 * part of the world they leave clear.
 */
export function guideCameraPadding(viewportHeight: number): MapCameraPadding {
  return {
    top: Math.round(viewportHeight * 0.08),
    right: 0,
    bottom: Math.round(viewportHeight * 0.36),
    left: 0,
  };
}

/** What her body is doing, from which the frame's pose is sampled. */
export type GuideBodyMotion =
  | {
      readonly kind: "walk";
      readonly from: MapPointSelection;
      readonly to: MapPointSelection;
      readonly startedMs: number;
      readonly durationMs: number;
    }
  | {
      readonly kind: "stand";
      readonly at: MapPointSelection;
      readonly facing: MapPointSelection;
      /** A gesture she makes once, standing. */
      readonly gesture?: {
        readonly clipId: AvatarClipId;
        readonly startedMs: number;
      };
    };

export interface GuideBodyPose {
  readonly point: MapPointSelection;
  readonly bearingDeg: number;
  readonly clipId: AvatarClipId;
  readonly clipPhase: number;
  /** A walk has somewhere to be, and asks for the next frame. */
  readonly moving: boolean;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

export function sampleGuideBody(
  motion: GuideBodyMotion,
  nowMs: number,
  reducedMotion: boolean,
): GuideBodyPose {
  if (motion.kind === "walk") {
    const elapsed = Math.max(0, nowMs - motion.startedMs);
    const t =
      reducedMotion || motion.durationMs <= 0
        ? 1
        : Math.min(1, elapsed / motion.durationMs);
    return {
      point: lerpPoint(motion.from, motion.to, easeInOut(t)),
      bearingDeg: mapCompassBearing(motion.from, motion.to),
      clipId: t < 1 && !reducedMotion ? "walk" : "idle",
      clipPhase:
        t < 1 && !reducedMotion
          ? (elapsed % GUIDE_WALK_CLIP_MS) / GUIDE_WALK_CLIP_MS
          : 0,
      moving: t < 1,
    };
  }
  const gestureElapsed =
    motion.gesture === undefined ? undefined : nowMs - motion.gesture.startedMs;
  const gesturing =
    motion.gesture !== undefined &&
    !reducedMotion &&
    gestureElapsed !== undefined &&
    gestureElapsed >= 0 &&
    gestureElapsed < GUIDE_GESTURE_MS;
  return {
    point: motion.at,
    bearingDeg: mapCompassBearing(motion.at, motion.facing),
    clipId: gesturing && motion.gesture ? motion.gesture.clipId : "idle",
    clipPhase: gesturing
      ? (gestureElapsed ?? 0) / GUIDE_GESTURE_MS
      : reducedMotion
        ? 0
        : (Math.max(0, nowMs) % GUIDE_IDLE_CLIP_MS) / GUIDE_IDLE_CLIP_MS,
    moving: gesturing,
  };
}

/**
 * She is drawn as Dasha 2.0 — unless that is the body the Bond itself wears,
 * in which case the first Dasha study stands in, so two people never share
 * one body on the same patch of ground.
 */
export function guideModel(
  bondModel: AvatarModelId | undefined,
): AvatarModelId {
  return bondModel === "dasha-v2-study" ? "dasha-study" : "dasha-v2-study";
}
