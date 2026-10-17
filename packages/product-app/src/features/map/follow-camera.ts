// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BODY_HANDOVER_ZOOM,
  mapMetersPerPixel,
  type MapCamera,
  type MapPointSelection,
  type MapDimension,
  type MapZoomPivot,
} from "@nilx-one/map-contract";

import { distanceMeters } from "./location-camera-policy";

/**
 * The camera that follows the body at the wheel, the way a game camera does.
 *
 * `locked` follows behind the head. `isometric` glides with the body in a stable
 * diagonal view, without rotating the world when the body turns. `free` is a Dota-style
 * independent map camera: dragging, touch panning and pointer zoom move the
 * camera without pulling it back to the body. An explicit selection, Space
 * or Y switches modes, and so does a two-finger pinch on a phone (out to
 * Free, in to Follow); a pan gesture never changes the mode.
 *
 * Presentation only: following never moves a body, records presence or
 * changes who owns the camera beyond what `camera-coordination.md` says.
 */
export type CameraFollow = "locked" | "isometric" | "free";

/** A world opens with the camera on the body at the wheel. */
export const INITIAL_CAMERA_FOLLOW: CameraFollow = "locked";

/** Every camera mode, in the order the mode control shows them. */
export const CAMERA_MODES: readonly CameraFollow[] = [
  "locked",
  "isometric",
  "free",
];

/** Who is at the wheel, as far as the camera is concerned. */
export type CameraIdentity = "bond" | "avaia" | "xping";

/**
 * The modes each identity offers. Follow is always among them; the control
 * still shows the rest, unavailable, so the set reads the same everywhere.
 */
const IDENTITY_CAMERA_MODES: Readonly<
  Record<CameraIdentity, readonly CameraFollow[]>
> = {
  bond: CAMERA_MODES,
  avaia: CAMERA_MODES,
  // xPing is only ever followed: Isometric and Free stay out of reach.
  xping: ["locked"],
};

export function cameraModesFor(
  identity: CameraIdentity,
): readonly CameraFollow[] {
  return IDENTITY_CAMERA_MODES[identity];
}

/**
 * How long a camera move the application has just started is left to finish
 * before the follow takes the camera again. It covers the renderer's own
 * eased transition; a move that settles sooner releases it sooner.
 */
export const FOLLOW_HOLD_MS = 900;

/** The same for the flight that opens a world on the body. */
export const FOLLOW_FLIGHT_HOLD_MS = 2_300;

/** The rendered body's position and facing, never device compass evidence. */
export interface FollowBody extends MapPointSelection {
  readonly bearingDeg: number;
}

/** Follow looks forward from behind the body's head. */
export const FOLLOW_PITCH = 60;
/** Isometric orientation belongs to the camera, not body facing. */
export const ISOMETRIC_PITCH = 50;
export const ISOMETRIC_BEARING = 45;
/** Exponential catch-up time; independent of the display's refresh rate. */
export const ISOMETRIC_RESPONSE_MS = 180;
/** A relocation is a new shot, never a long chase through intervening geography. */
export const ISOMETRIC_RELOCATION_METERS = 60;
/**
 * Follow never goes wider than the scale a body is drawn from, so the body
 * stays on the world; any closer zoom the person chose is kept. A floor any
 * higher would hold a phone at a dozen metres of ground: in an open park or
 * under the fog that reads as an empty screen, and since pinching out leaves
 * Follow, there would be no way to see more while staying in it.
 */
export const FOLLOW_MIN_ZOOM = MAP_BODY_HANDOVER_ZOOM;
/** Explicit button distances; opening Follow retains the world's wider view. */
export const FOLLOW_DISTANCE_ZOOMS = [21.5, 21, 20.5] as const;
/** Three steps away, then three steps back to the starting distance. */
export const FREE_DISTANCE_STEPS = [-1, -2, -3, -2, -1, 0] as const;

/**
 * Aim along the line through a nominal 1.6 m head above the ground. MapCamera
 * centres a ground coordinate, so its target lies ahead by height * tan(pitch).
 * This puts the camera behind the body looking over its head, without moving
 * the avatar or coupling the map contract to a particular skeleton.
 */
export function followCamera(
  current: MapCamera,
  body: FollowBody,
  dimension: MapDimension = "volumetric",
  minimumZoom: number = FOLLOW_MIN_ZOOM,
): MapCamera {
  return framedBodyCamera(
    current,
    body,
    minimumZoom,
    ((body.bearingDeg % 360) + 360) % 360,
    dimension === "flat" ? 0 : FOLLOW_PITCH,
  );
}

export function isometricCamera(
  current: MapCamera,
  body: FollowBody,
  dimension: MapDimension = "volumetric",
): MapCamera {
  return framedBodyCamera(
    current,
    body,
    FOLLOW_MIN_ZOOM,
    ISOMETRIC_BEARING,
    dimension === "flat" ? 0 : ISOMETRIC_PITCH,
  );
}

function framedBodyCamera(
  current: MapCamera,
  body: FollowBody,
  minimumZoom: number,
  bearing: number,
  pitch: number,
): MapCamera {
  const distance = 1.6 * Math.tan((pitch * Math.PI) / 180);
  const angular = distance / 6_371_008.8;
  const heading = (bearing * Math.PI) / 180;
  const latitude = (body.latitude * Math.PI) / 180;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(angular) +
      Math.cos(latitude) * Math.sin(angular) * Math.cos(heading),
  );
  const longitudeOffset = Math.atan2(
    Math.sin(heading) * Math.sin(angular) * Math.cos(latitude),
    Math.cos(angular) - Math.sin(latitude) * Math.sin(targetLatitude),
  );
  return {
    center:
      pitch === 0
        ? [body.longitude, body.latitude]
        : [
            ((body.longitude + (longitudeOffset * 180) / Math.PI + 540) % 360) -
              180,
            (targetLatitude * 180) / Math.PI,
          ],
    zoom: Math.max(current.zoom, minimumZoom),
    bearing,
    pitch,
  };
}

/** Smooth the ground target, retaining distance and the stable camera angle. */
export function smoothIsometricCamera(
  current: MapCamera,
  target: MapCamera,
  elapsedMs: number,
): MapCamera {
  const distance = distanceMeters(current.center, target.center);
  if (
    distance < 0.05 ||
    distance > ISOMETRIC_RELOCATION_METERS ||
    elapsedMs > 1_000
  )
    return target;
  const alpha = 1 - Math.exp(-Math.max(0, elapsedMs) / ISOMETRIC_RESPONSE_MS);
  const longitude = ((target.center[0] - current.center[0] + 540) % 360) - 180;
  return {
    ...target,
    center: [
      ((current.center[0] + longitude * alpha + 540) % 360) - 180,
      current.center[1] + (target.center[1] - current.center[1]) * alpha,
    ],
  };
}

/** Equivalent wrapped bearings and tiny projection roundoff need no update. */
export function sameFollowCamera(
  current: MapCamera,
  target: MapCamera,
): boolean {
  const turn = ((current.bearing - target.bearing + 540) % 360) - 180;
  return (
    Math.abs(current.center[0] - target.center[0]) < 1e-9 &&
    Math.abs(current.center[1] - target.center[1]) < 1e-9 &&
    Math.abs(current.zoom - target.zoom) < 1e-6 &&
    Math.abs(turn) < 1e-6 &&
    Math.abs(current.pitch - target.pitch) < 1e-6
  );
}

/**
 * How far two fingers have to zoom, in zoom levels, before the pinch changes
 * the mode rather than only the distance. Below it a pinch is just a nudge.
 */
export const PINCH_MODE_ZOOM = 0.35;

/**
 * What a finished touch zoom asks of the mode, the way a phone game camera
 * answers two fingers: pinching out steps back from the body into Free to
 * look around, pinching in returns to Follow. A pinch the same way as the
 * mode it is already in, or one too small to mean anything, changes nothing.
 */
export function followAfterPinch(
  follow: CameraFollow,
  startZoom: number,
  endZoom: number,
): CameraFollow {
  const zoomed = endZoom - startZoom;
  if (follow !== "free" && zoomed <= -PINCH_MODE_ZOOM) return "free";
  if (follow === "free" && zoomed >= PINCH_MODE_ZOOM) return "locked";
  return follow;
}

/** A locked camera closes in on the body it is centred on. */
export function zoomPivotFor(follow: CameraFollow): MapZoomPivot {
  return follow === "free" ? "pointer" : "center";
}

/**
 * How far the centre has to move before the world reads the camera again.
 * A follow moves the camera every frame by much less than this; the world's
 * own reading of it (zoom, "centred", recentring) is unchanged by a few
 * pixels, and re-reading it sixty times a second is not.
 */
export const CAMERA_READ_PIXELS = 8;

const ANGLE_EPSILON = 1e-3;

export function cameraChangeVisible(
  previous: MapCamera,
  next: MapCamera,
): boolean {
  if (
    Math.abs(previous.zoom - next.zoom) > ANGLE_EPSILON ||
    Math.abs(previous.bearing - next.bearing) > ANGLE_EPSILON ||
    Math.abs(previous.pitch - next.pitch) > ANGLE_EPSILON
  ) {
    return true;
  }
  const pixels =
    CAMERA_READ_PIXELS * mapMetersPerPixel(next.center[1], next.zoom);
  return distanceMeters(previous.center, next.center) >= pixels;
}

/**
 * The keys a game camera answers: Space brings it back onto the body and
 * locks it there, Y locks or unlocks it, as in a MOBA.
 */
export type CameraKeyCommand = "center" | "toggle";

export interface CameraKeyEvent {
  readonly key: string;
  /** The physical key, so Y is the same key on a Ukrainian layout. */
  readonly code?: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: EventTarget | null;
}

/** A key pressed into a control belongs to that control, not to the camera. */
const CONTROL_SELECTOR =
  "input, textarea, select, button, a[href], summary, dialog, [aria-modal='true'], [contenteditable]:not([contenteditable='false']), [role='button'], [role='textbox'], [role='slider'], [role='switch'], [role='checkbox'], [role='radio'], [role='combobox'], [role='listbox'], [role='option'], [role='menu'], [role='menuitem'], [role='tab'], [role='dialog']";

export function cameraKeyCommand(
  event: CameraKeyEvent,
): CameraKeyCommand | undefined {
  // Holding a key should not restart a camera animation every repeat frame.
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey)
    return undefined;
  if (
    typeof Element !== "undefined" &&
    event.target instanceof Element &&
    event.target.closest(CONTROL_SELECTOR) !== null
  ) {
    return undefined;
  }
  if (event.code === "Space" || event.key === " ") return "center";
  if (event.code === "KeyY" || event.key === "y" || event.key === "Y") {
    return "toggle";
  }
  return undefined;
}
