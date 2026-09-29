// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapCompassBearing,
  type AvatarClipId,
  type AvatarModelId,
  type MapBounds,
  type MapCamera,
  type MapCameraPadding,
  type MapObstacle,
  type MapPointSelection,
} from "@nilx-one/map-contract";

/**
 * Where a scene with xSasha is staged, and how the camera frames it.
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

/**
 * After the introduction she walks off. The reward scene finds her further
 * away than she stood to talk — far enough that the place stands behind her —
 * and she turns back to the Bond from there.
 */
export const GUIDE_ASIDE_METERS = 20;
/** Where she goes once she has said it. */
export const GUIDE_ASIDE_EXIT_METERS = 12;
/** Turning back to the Bond, the short way round. */
export const GUIDE_TURN_MS = 900;

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
  /**
   * `near` — she walks up and talks at arm's length; `aside` — she is found a
   * way off, with the place behind her, and talks from there.
   */
  readonly kind: "near" | "aside";
  /** The way from the Bond to her, clockwise from north. */
  readonly bearing: number;
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
    kind: "near",
    bearing: 0,
    you: { longitude: you.longitude, latitude: you.latitude },
    dasha: offsetPoint(you, 0, GUIDE_STAND_METERS),
    entry: offsetPoint(you, GUIDE_ENTRY_BEARING, GUIDE_ENTRY_METERS),
  };
}

/** She stands a way off along `bearing`, and leaves further along it. */
export function guideAsideStage(
  you: MapPointSelection,
  bearing: number,
): GuideStage {
  return {
    kind: "aside",
    bearing,
    you: { longitude: you.longitude, latitude: you.latitude },
    dasha: offsetPoint(you, bearing, GUIDE_ASIDE_METERS),
    entry: offsetPoint(
      you,
      bearing,
      GUIDE_ASIDE_METERS + GUIDE_ASIDE_EXIT_METERS,
    ),
  };
}

/** Past her, where the camera looks for something built to stand her against. */
const BACKDROP_NEAR_METERS = 6;
const BACKDROP_FAR_METERS = 70;
const BACKDROP_HALF_WIDTH_METERS = 16;
const BACKDROP_SPREAD = 0.35;
const ASIDE_CANDIDATES = 12;

type Local = readonly [east: number, north: number];

function localOf(origin: MapPointSelection, lngLat: readonly number[]): Local {
  return [
    ((lngLat[0] ?? origin.longitude) - origin.longitude) *
      METERS_PER_DEGREE_LATITUDE *
      Math.cos(radians(origin.latitude)),
    ((lngLat[1] ?? origin.latitude) - origin.latitude) *
      METERS_PER_DEGREE_LATITUDE,
  ];
}

function boundsAround(center: MapPointSelection, meters: number): MapBounds {
  const dLat = meters / METERS_PER_DEGREE_LATITUDE;
  const dLng =
    meters / (METERS_PER_DEGREE_LATITUDE * Math.cos(radians(center.latitude)));
  return {
    west: center.longitude - dLng,
    south: center.latitude - dLat,
    east: center.longitude + dLng,
    north: center.latitude + dLat,
  };
}

function insideRing(point: Local, ring: readonly Local[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: Local, a: Local, b: Local): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function crossesRing(from: Local, to: Local, ring: readonly Local[]): boolean {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    if (
      cross(from, to, a) * cross(from, to, b) < 0 &&
      cross(a, b, from) * cross(a, b, to) < 0
    ) {
      return true;
    }
  }
  return false;
}

/** The ways she might be standing, nearest to the way she walked off first. */
function asideCandidates(): number[] {
  const step = 360 / ASIDE_CANDIDATES;
  const bearings = [GUIDE_ENTRY_BEARING];
  for (let k = 1; bearings.length < ASIDE_CANDIDATES; k += 1) {
    bearings.push((GUIDE_ENTRY_BEARING + k * step) % 360);
    if (bearings.length < ASIDE_CANDIDATES) {
      bearings.push((GUIDE_ENTRY_BEARING - k * step + 360) % 360);
    }
  }
  return bearings;
}

/**
 * Which way from the Bond she is found for the reward scene: where the real
 * place has buildings standing behind her, so the close-up is of her against
 * the place rather than against empty ground.
 *
 * It reads only what the basemap already loaded, like every other obstacle
 * query. She never stands inside a building or in water, and never behind a
 * wall from the Bond. With nothing built nearby — or a renderer that cannot
 * say — she is where she walked off to.
 */
export function guideAsideBearing(
  you: MapPointSelection,
  obstaclesWithin?: (bounds: MapBounds) => readonly MapObstacle[],
): number {
  if (obstaclesWithin === undefined) return GUIDE_ENTRY_BEARING;
  const reach = GUIDE_ASIDE_METERS + BACKDROP_FAR_METERS;
  const rings = obstaclesWithin(boundsAround(you, reach)).flatMap((obstacle) =>
    obstacle.polygons.map((polygon) => ({
      kind: obstacle.kind,
      outer: (polygon[0] ?? []).map((lngLat) => localOf(you, lngLat)),
    })),
  );
  if (rings.length === 0) return GUIDE_ENTRY_BEARING;

  let best: { bearing: number; score: number } | undefined;
  for (const bearing of asideCandidates()) {
    const east = Math.sin(radians(bearing));
    const north = Math.cos(radians(bearing));
    const her: Local = [east * GUIDE_ASIDE_METERS, north * GUIDE_ASIDE_METERS];
    const blocked = rings.some(
      (ring) =>
        insideRing(her, ring.outer) ||
        (ring.kind === "building" && crossesRing([0, 0], her, ring.outer)),
    );
    if (blocked) continue;
    let score = 0;
    for (const ring of rings) {
      if (ring.kind !== "building") continue;
      const behind = ring.outer.some(([x, y]) => {
        const along = (x - her[0]) * east + (y - her[1]) * north;
        const across = Math.abs((x - her[0]) * north - (y - her[1]) * east);
        return (
          along >= BACKDROP_NEAR_METERS &&
          along <= BACKDROP_FAR_METERS &&
          across <= BACKDROP_HALF_WIDTH_METERS + along * BACKDROP_SPREAD
        );
      });
      if (behind) score += 1;
    }
    if (best === undefined || score > best.score) best = { bearing, score };
  }
  return best?.bearing ?? GUIDE_ENTRY_BEARING;
}

interface ShotFrame {
  /** How far from the Bond towards her the camera centres, 0 to 1. */
  readonly focus: number;
  readonly zoom: number;
  readonly pitch: number;
  /**
   * The way the camera looks, turned from the way the Bond looks at her: 0
   * films her face over the Bond's shoulder, 180 the Bond's over hers.
   */
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

/**
 * The same coverage when she is a way off. Her close-ups look past her at
 * the place, so what is built there is what stands behind her.
 */
const ASIDE_SHOTS: Readonly<Record<GuideShot, ShotFrame>> = {
  establish: { focus: 0.86, zoom: 20.6, pitch: 58, bearing: 0 },
  dasha: { focus: 0.95, zoom: 21.6, pitch: 60, bearing: 8 },
  reward: { focus: 0.95, zoom: 21.3, pitch: 60, bearing: 352 },
  you: { focus: 0.06, zoom: 21.6, pitch: 58, bearing: 196 },
  "two-shot": { focus: 0.5, zoom: 19.6, pitch: 52, bearing: 96 },
};

export function guideShotCamera(shot: GuideShot, stage: GuideStage): MapCamera {
  if (stage.kind === "aside") {
    const frame = ASIDE_SHOTS[shot];
    const center = lerpPoint(stage.you, stage.dasha, frame.focus);
    return {
      center: [center.longitude, center.latitude],
      zoom: frame.zoom,
      pitch: Math.min(GUIDE_MAX_PITCH, frame.pitch),
      bearing: (stage.bearing + frame.bearing) % 360,
    };
  }
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
    bearing: (stage.bearing + frame.bearing) % 360,
  };
}

/**
 * What is built around the stage, in metres east and north of the Bond, and
 * how tall — everything that could stand between the camera and the two of
 * them.
 */
export interface GuideSightlines {
  readonly origin: MapPointSelection;
  readonly walls: readonly GuideWall[];
}

interface GuideWall {
  readonly ring: readonly Local[];
  readonly height: number;
}

/** Nothing built is known: every shot is as clear as it was written. */
export const OPEN_GROUND: GuideSightlines = {
  origin: { longitude: 0, latitude: 0 },
  walls: [],
};

/** Far enough to hold where the widest shot puts the camera. */
const SIGHTLINE_REACH_METERS = 180;
/** A building the basemap raises without saying how far. */
const UNKNOWN_WALL_METERS = 7;

/**
 * The buildings the basemap has already loaded around the Bond, read once as
 * a scene starts. Water never hides anyone, so it is left out. A renderer
 * that cannot say leaves the ground open.
 */
export function guideSightlines(
  you: MapPointSelection,
  obstaclesWithin?: (bounds: MapBounds) => readonly MapObstacle[],
): GuideSightlines {
  if (obstaclesWithin === undefined) return OPEN_GROUND;
  const walls = obstaclesWithin(boundsAround(you, SIGHTLINE_REACH_METERS))
    .filter((obstacle) => obstacle.kind === "building")
    .flatMap((obstacle) =>
      obstacle.polygons.map((polygon, index) => ({
        ring: (polygon[0] ?? []).map((lngLat) => localOf(you, lngLat)),
        height: obstacle.heights?.[index] ?? UNKNOWN_WALL_METERS,
      })),
    )
    .filter((wall) => wall.ring.length >= 3);
  return { origin: you, walls };
}

/** How far along `from`→`to`, 0 to 1, the segment first meets the ring. */
function firstCrossing(
  from: Local,
  to: Local,
  ring: readonly Local[],
): number | undefined {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  let first: number | undefined;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[j];
    const b = ring[i];
    if (a === undefined || b === undefined) continue;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const denominator = dx * ey - dy * ex;
    if (denominator === 0) continue;
    const t = ((a[0] - from[0]) * ey - (a[1] - from[1]) * ex) / denominator;
    const u = ((a[0] - from[0]) * dy - (a[1] - from[1]) * dx) / denominator;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    if (first === undefined || t < first) first = t;
  }
  return first;
}

/**
 * MapLibre's default field of view puts the eye one and a half viewport
 * heights from the point it looks at, in pixels of the tile world.
 */
const EYE_DISTANCE_PER_VIEWPORT_HEIGHT = 1.5;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;
const TILE_WORLD_PIXELS = 512;
/** Seen from the chest up: a sightline is drawn to here, not to the feet. */
const SUBJECT_SIGHT_METERS = 1.2;
/** The frame is wider than a line: a wall just beside it still fills it. */
const SIGHT_SHOULDER_METERS = 1.5;

/** Where the camera's eye is, over the ground, for a camera on this stage. */
function eyeOf(
  camera: MapCamera,
  origin: MapPointSelection,
  viewportHeight: number,
): { readonly at: Local; readonly height: number; readonly across: Local } {
  const metersPerPixel =
    (EARTH_CIRCUMFERENCE_METERS * Math.cos(radians(camera.center[1]))) /
    (TILE_WORLD_PIXELS * 2 ** camera.zoom);
  const distance =
    EYE_DISTANCE_PER_VIEWPORT_HEIGHT * viewportHeight * metersPerPixel;
  const pitch = radians(camera.pitch);
  const behind = radians(camera.bearing + 180);
  const reach = distance * Math.sin(pitch);
  const center = localOf(origin, camera.center);
  return {
    at: [
      center[0] + Math.sin(behind) * reach,
      center[1] + Math.cos(behind) * reach,
    ],
    height: distance * Math.cos(pitch),
    across: [Math.cos(behind), -Math.sin(behind)],
  };
}

/**
 * Whether the camera sees both of them: no building the basemap raises
 * stands between its eye and either body. A building someone is standing
 * inside — a fix taken indoors — cannot be filmed round, and is let be.
 */
export function shotIsClear(
  camera: MapCamera,
  stage: GuideStage,
  sightlines: GuideSightlines,
  viewportHeight: number,
): boolean {
  if (sightlines.walls.length === 0) return true;
  const eye = eyeOf(camera, sightlines.origin, viewportHeight);
  for (const subject of [stage.you, stage.dasha]) {
    const body = localOf(sightlines.origin, [
      subject.longitude,
      subject.latitude,
    ]);
    for (const wall of sightlines.walls) {
      if (insideRing(body, wall.ring)) continue;
      for (const shoulder of [0, -1, 1]) {
        const offset = shoulder * SIGHT_SHOULDER_METERS;
        const t = firstCrossing(
          body,
          [
            eye.at[0] + eye.across[0] * offset,
            eye.at[1] + eye.across[1] * offset,
          ],
          wall.ring,
        );
        if (t === undefined) continue;
        const sight =
          SUBJECT_SIGHT_METERS + (eye.height - SUBJECT_SIGHT_METERS) * t;
        if (wall.height > sight) return false;
      }
    }
  }
  return true;
}

/** Turning round them costs a degree a degree; looking down costs more. */
const RESHOOT_BEARING_STEP = 10;
const RESHOOT_PITCH_STEP = 8;
const RESHOOT_MIN_PITCH = 20;
const RESHOOT_PITCH_COST = 3;

/**
 * The written shot, or the nearest one to it that is not filmed through a
 * wall: turned a little round the two of them first, lowered towards
 * overhead where turning is not enough, and straight down when nothing else
 * sees them — from overhead nothing stands in the way.
 */
export function clearShot(
  camera: MapCamera,
  stage: GuideStage,
  sightlines: GuideSightlines,
  viewportHeight: number,
): MapCamera {
  if (shotIsClear(camera, stage, sightlines, viewportHeight)) return camera;
  const candidates: { readonly camera: MapCamera; readonly cost: number }[] =
    [];
  for (
    let pitch = camera.pitch;
    pitch >= Math.min(camera.pitch, RESHOOT_MIN_PITCH);
    pitch -= RESHOOT_PITCH_STEP
  ) {
    for (
      let turn = -180 + RESHOOT_BEARING_STEP;
      turn <= 180;
      turn += RESHOOT_BEARING_STEP
    ) {
      candidates.push({
        camera: {
          ...camera,
          pitch,
          bearing: (((camera.bearing + turn) % 360) + 360) % 360,
        },
        cost: Math.abs(turn) + (camera.pitch - pitch) * RESHOOT_PITCH_COST,
      });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  for (const candidate of candidates) {
    if (shotIsClear(candidate.camera, stage, sightlines, viewportHeight)) {
      return candidate.camera;
    }
  }
  return { ...camera, pitch: 0 };
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
      /** Turning where she stands, from one way to another. */
      readonly kind: "turn";
      readonly at: MapPointSelection;
      readonly fromBearing: number;
      readonly toBearing: number;
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
  if (motion.kind === "turn") {
    const elapsed = Math.max(0, nowMs - motion.startedMs);
    const t =
      reducedMotion || motion.durationMs <= 0
        ? 1
        : Math.min(1, elapsed / motion.durationMs);
    // The short way round, the way a person turns.
    const sweep = ((motion.toBearing - motion.fromBearing + 540) % 360) - 180;
    return {
      point: motion.at,
      bearingDeg: (motion.fromBearing + sweep * easeInOut(t) + 360) % 360,
      clipId: t < 1 ? "turn_in_place" : "idle",
      clipPhase: t < 1 ? t : 0,
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
 * She is never the Bond's own body: two of the same would read as a mirror.
 * Sky meets her as Dasha 2.0, Dasha and Dasha 2.0 meet her as Sky, and Kai
 * meets her as Dasha. A Bond this device has no body for meets her as
 * Dasha 2.0.
 *
 * A study with changeable clothes is drawn in its default appearance, never in
 * what the Bond has on.
 */
export function guideModel(
  bondModel: AvatarModelId | undefined,
): AvatarModelId {
  switch (bondModel) {
    case "sky-study":
      return "dasha-v2-study";
    case "dasha-study":
    case "dasha-v2-study":
      return "sky-study";
    case "kai-study":
      return "dasha-study";
    case undefined:
      return "dasha-v2-study";
  }
}
