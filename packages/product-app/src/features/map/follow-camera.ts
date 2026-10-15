// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapMetersPerPixel,
  type MapCamera,
  type MapPointSelection,
  type MapZoomPivot,
} from "@nilx-one/map-contract";

import { distanceMeters } from "./location-camera-policy";

/**
 * The camera that follows the body at the wheel, the way a game camera does.
 *
 * `locked` is the default Follow camera: it tracks the walking body while
 * preserving chosen zoom, bearing and pitch. `free` is a Dota-style
 * independent map camera: dragging, touch panning and pointer zoom move the
 * camera without pulling it back to the body. An explicit selection, Space
 * or Y switches modes, and so does a two-finger pinch on a phone (out to
 * Free, in to Follow); a pan gesture never changes the mode.
 *
 * Presentation only: following never moves a body, records presence or
 * changes who owns the camera beyond what `camera-coordination.md` says.
 */
export type CameraFollow = "locked" | "free";

/** A world opens with the camera on the body at the wheel. */
export const INITIAL_CAMERA_FOLLOW: CameraFollow = "locked";

/**
 * How long a camera move the application has just started is left to finish
 * before the follow takes the camera again. It covers the renderer's own
 * eased transition; a move that settles sooner releases it sooner.
 */
export const FOLLOW_HOLD_MS = 900;

/** The same for the flight that opens a world on the body. */
export const FOLLOW_FLIGHT_HOLD_MS = 2_300;

/** The camera on the body: zoom, bearing and pitch are the person's. */
export function followCamera(
  current: MapCamera,
  body: MapPointSelection,
): MapCamera {
  return { ...current, center: [body.longitude, body.latitude] };
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
  if (follow === "locked" && zoomed <= -PINCH_MODE_ZOOM) return "free";
  if (follow === "free" && zoomed >= PINCH_MODE_ZOOM) return "locked";
  return follow;
}

/** A locked camera closes in on the body it is centred on. */
export function zoomPivotFor(follow: CameraFollow): MapZoomPivot {
  return follow === "locked" ? "center" : "pointer";
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
