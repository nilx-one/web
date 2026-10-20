// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ObservedGeolocation } from "@nilx-one/host-contract";
import type { MapCamera } from "@nilx-one/map-contract";
import {
  followCamera,
  isometricCamera,
  type CameraFollow,
} from "./follow-camera";
import {
  firstFixCamera,
  type LocationCameraContext,
} from "./location-camera-policy";

export function openingCamera(
  position: ObservedGeolocation,
  context: LocationCameraContext,
  mode: CameraFollow,
  bearingDeg = 0,
): MapCamera {
  const camera = firstFixCamera(position, context);
  const body = { ...position, bearingDeg };
  if (mode === "isometric")
    return isometricCamera(camera, body, context.dimension);
  if (mode === "locked") return followCamera(camera, body, context.dimension);
  return camera;
}
