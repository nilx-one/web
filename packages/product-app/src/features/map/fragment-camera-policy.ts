// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_SCALE_ZOOM,
  type MapCamera,
  type MapScale,
} from "@nilx-one/map-contract";

import {
  locationCameraPitch,
  locationCameraZoom,
  type LocationCameraContext,
} from "./location-camera-policy";

/**
 * Adapter-neutral projection of an opaque spatial cell.
 *
 * H3 decoding belongs to `presence-geo`; the product receives only the opaque
 * cell identity plus the geographic centre required to frame it.
 */
export interface CellCameraAnchor {
  readonly cell: string;
  readonly center: readonly [longitude: number, latitude: number];
}

/** A fragment never drags the world out beyond useful local context. */
export const FRAGMENT_MIN_SCALE: MapScale = "neighborhood";
/** Nor may narration force a building close-up from a cell-level fact. */
export const FRAGMENT_MAX_SCALE: MapScale = "street";

/**
 * Produce the bounded camera target for a cell-bound fragment.
 *
 * The cell centre is presentation geometry, not a claim that a Bond or Avaia
 * is at that coordinate. Current bearing is preserved. Zoom is clamped to a
 * local range, and explicit 2D remains flat.
 */
export function fragmentCamera(
  anchor: CellCameraAnchor,
  current: MapCamera,
  context: LocationCameraContext,
): MapCamera {
  const minimum = locationCameraZoom(FRAGMENT_MIN_SCALE, context.presentation);
  const maximum = Math.max(
    minimum,
    locationCameraZoom(FRAGMENT_MAX_SCALE, context.presentation),
  );
  const zoom = Math.min(maximum, Math.max(minimum, current.zoom));
  const zoomChanged = zoom !== current.zoom;

  return {
    center: anchor.center,
    zoom,
    bearing: current.bearing,
    pitch:
      context.dimension === "flat"
        ? 0
        : zoomChanged
          ? locationCameraPitch(zoom, "volumetric")
          : current.pitch,
  };
}

/** Useful for tests and callers that need the absolute style bounds. */
export function fragmentZoomBounds(context: LocationCameraContext): {
  readonly minimum: number;
  readonly maximum: number;
} {
  const minimum = locationCameraZoom(FRAGMENT_MIN_SCALE, context.presentation);
  return {
    minimum,
    maximum: Math.max(
      minimum,
      Math.min(
        MAP_SCALE_ZOOM.building,
        locationCameraZoom(FRAGMENT_MAX_SCALE, context.presentation),
      ),
    ),
  };
}
