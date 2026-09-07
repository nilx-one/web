// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_SCALE_ZOOM,
  mapMetersPerPixel,
  type MapCamera,
  type MapCameraMotion,
  type MapCameraPadding,
  type MapDimension,
  type MapScale,
} from "@nilx-one/map-contract";
import type { ObservedGeolocation } from "@nilx-one/host-contract";

import type { ShellSafeArea } from "../../shell/app-shell";
import type { ShellPresentation } from "../../shell/shell-presentation";

/**
 * Camera policy for observed device location.
 *
 * A camera centred on a coordinate is presentation. It is never evidence that
 * a Bond is present there, and none of this writes shared-world state.
 */

/**
 * The first fix lands at neighbourhood scale. Building scale is where a person
 * arrives by zooming, not where the map drops them the moment a fix resolves.
 */
export const FIRST_FIX_SCALE: MapScale = "neighborhood";

/** Recentering never leaves the camera further out than useful local context. */
export const RECENTER_MIN_SCALE: MapScale = "neighborhood";

/**
 * A narrow viewport shows less ground at the same zoom, so it starts slightly
 * wider to keep the same amount of context around the observation.
 */
const PRESENTATION_ZOOM_OFFSET: Readonly<Record<ShellPresentation, number>> = {
  compact: -0.5,
  regular: 0,
  wide: 0.25,
};

/**
 * Foreground chrome the observation must not hide behind: the header above,
 * the Dock and status rail below, and the shell gutters at the sides. Safe-area
 * insets are added on top of these by `locationCameraPadding`.
 */
const CHROME_INSETS: Readonly<Record<ShellPresentation, MapCameraPadding>> = {
  compact: { top: 72, right: 16, bottom: 232, left: 16 },
  regular: { top: 76, right: 24, bottom: 248, left: 24 },
  wide: { top: 80, right: 32, bottom: 264, left: 32 },
};

/**
 * Pitch rises with zoom so one world becomes progressively more dimensional
 * instead of switching into a separate building view. Explicit 2D keeps the
 * same geography flat and is never overridden by this ramp.
 */
export function locationCameraPitch(
  zoom: number,
  dimension: MapDimension,
): number {
  if (dimension === "flat") {
    return 0;
  }
  if (zoom <= MAP_SCALE_ZOOM.city) {
    return 0;
  }
  if (zoom >= MAP_SCALE_ZOOM.building) {
    return 48;
  }

  const span = MAP_SCALE_ZOOM.building - MAP_SCALE_ZOOM.city;
  const progress = (zoom - MAP_SCALE_ZOOM.city) / span;
  return Math.round(progress * 48);
}

export function locationCameraZoom(
  scale: MapScale,
  presentation: ShellPresentation,
): number {
  return MAP_SCALE_ZOOM[scale] + PRESENTATION_ZOOM_OFFSET[presentation];
}

export interface LocationCameraContext {
  readonly presentation: ShellPresentation;
  readonly dimension: MapDimension;
  readonly safeArea: ShellSafeArea;
}

export function locationCameraPadding(
  context: LocationCameraContext,
): MapCameraPadding {
  const chrome = CHROME_INSETS[context.presentation];
  return {
    top: chrome.top + context.safeArea.top,
    right: chrome.right + context.safeArea.right,
    bottom: chrome.bottom + context.safeArea.bottom,
    left: chrome.left + context.safeArea.left,
  };
}

/** Where the camera goes when the first observation of a world resolves. */
export function firstFixCamera(
  position: ObservedGeolocation,
  context: LocationCameraContext,
): MapCamera {
  const zoom = locationCameraZoom(FIRST_FIX_SCALE, context.presentation);
  return {
    center: [position.longitude, position.latitude],
    zoom,
    bearing: 0,
    pitch: locationCameraPitch(zoom, context.dimension),
  };
}

/**
 * Recentering respects where the person already is: their zoom, bearing and
 * pitch survive unless they are so far out that the observation would carry no
 * local context. Only a zoom this policy had to raise brings the pitch ramp
 * with it; a camera the person built keeps the pitch they chose.
 */
export function recenterCamera(
  position: ObservedGeolocation,
  current: MapCamera,
  context: LocationCameraContext,
): MapCamera {
  const minimum = locationCameraZoom(RECENTER_MIN_SCALE, context.presentation);
  const raised = current.zoom < minimum;
  const zoom = raised ? minimum : current.zoom;

  return {
    center: [position.longitude, position.latitude],
    zoom,
    bearing: current.bearing,
    pitch:
      context.dimension === "flat"
        ? 0
        : raised
          ? locationCameraPitch(zoom, "volumetric")
          : current.pitch,
  };
}

export function cameraMotion(reducedMotion: boolean): MapCameraMotion {
  return reducedMotion ? "immediate" : "eased";
}

/** Screen distance from the viewport centre that still reads as "here". */
const CENTERED_TOLERANCE_PIXELS = 48;

const EARTH_RADIUS_METERS = 6_371_008.8;

export function distanceMeters(
  from: readonly [longitude: number, latitude: number],
  to: readonly [longitude: number, latitude: number],
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const latitudeSpan = toRadians(to[1] - from[1]);
  const longitudeSpan = toRadians(to[0] - from[0]);
  const a =
    Math.sin(latitudeSpan / 2) ** 2 +
    Math.cos(toRadians(from[1])) *
      Math.cos(toRadians(to[1])) *
      Math.sin(longitudeSpan / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Whether the camera still frames the observation. This is what separates
 * "centred" from "displaced" on the location control, and it is presentation
 * state only: panning away changes the camera, never the observation.
 */
export function cameraFramesPosition(
  camera: MapCamera,
  position: ObservedGeolocation,
): boolean {
  const tolerance =
    CENTERED_TOLERANCE_PIXELS *
    mapMetersPerPixel(position.latitude, camera.zoom);
  return (
    distanceMeters(camera.center, [position.longitude, position.latitude]) <=
    tolerance
  );
}
