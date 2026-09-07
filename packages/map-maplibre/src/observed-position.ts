// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapMetersPerPixel,
  type MapObservedPosition,
} from "@nilx-one/map-contract";

export const OBSERVED_POSITION_SOURCE_ID = "observed-position";
export const OBSERVED_POSITION_ACCURACY_LAYER_ID = "observed-position-accuracy";
export const OBSERVED_POSITION_EDGE_LAYER_ID = "observed-position-edge";
export const OBSERVED_POSITION_POINT_LAYER_ID = "observed-position-point";

/** The label is identity context, so it only earns its room at street scale. */
export const OBSERVED_POSITION_LABEL_MIN_ZOOM = 14;

const ACCENT = "#37d7e5";

// Presentation clamps. They bound what is drawn; the observation itself is
// never rewritten, so application state keeps the accuracy the host reported.
const MIN_ACCURACY_METERS = 6;
const MAX_ACCURACY_METERS = 2_000;
const MAX_ACCURACY_PIXELS = 320;

const ACCURACY_MIN_ZOOM = 0;
const ACCURACY_MAX_ZOOM = 24;

export function clampAccuracyMeters(accuracyMeters: number): number {
  if (!Number.isFinite(accuracyMeters) || accuracyMeters <= 0) {
    return MIN_ACCURACY_METERS;
  }
  return Math.min(
    Math.max(accuracyMeters, MIN_ACCURACY_METERS),
    MAX_ACCURACY_METERS,
  );
}

/**
 * The halo has to stay a geographic radius rather than a screen decoration, so
 * it is expressed as the pixel radius the accuracy occupies at this latitude,
 * interpolated on base 2 — the rate at which a fixed ground distance grows per
 * zoom level. The result tracks the ground exactly between the two stops.
 */
export function accuracyRadiusExpression(
  position: MapObservedPosition,
): unknown {
  const latitude = position.center[1];
  const accuracy = clampAccuracyMeters(position.accuracyMeters);
  const radiusAt = (zoom: number): number =>
    accuracy / mapMetersPerPixel(latitude, zoom);

  return [
    "min",
    [
      "interpolate",
      ["exponential", 2],
      ["zoom"],
      ACCURACY_MIN_ZOOM,
      radiusAt(ACCURACY_MIN_ZOOM),
      ACCURACY_MAX_ZOOM,
      radiusAt(ACCURACY_MAX_ZOOM),
    ],
    MAX_ACCURACY_PIXELS,
  ];
}

export function observedPositionFeature(
  position: MapObservedPosition,
): Record<string, unknown> {
  return {
    type: "Feature",
    // Presentation geometry only: no identity, no Bond, no protocol payload.
    properties: {},
    geometry: {
      type: "Point",
      coordinates: [position.center[0], position.center[1]],
    },
  };
}

export function observedPositionSource(
  position: MapObservedPosition,
): Record<string, unknown> {
  return {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [observedPositionFeature(position)],
    },
  };
}

/**
 * Three restrained circles rather than a conventional pin: the accuracy the
 * host reported, a pale edge that keeps the point legible over near-white
 * buildings, and the exact coordinate itself.
 */
export function observedPositionLayers(
  position: MapObservedPosition,
): readonly Record<string, unknown>[] {
  return [
    {
      id: OBSERVED_POSITION_ACCURACY_LAYER_ID,
      type: "circle",
      source: OBSERVED_POSITION_SOURCE_ID,
      paint: {
        "circle-radius": accuracyRadiusExpression(position),
        "circle-color": ACCENT,
        "circle-opacity": 0.14,
        "circle-stroke-color": ACCENT,
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.34,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: OBSERVED_POSITION_EDGE_LAYER_ID,
      type: "circle",
      source: OBSERVED_POSITION_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 10],
        "circle-color": ACCENT,
        "circle-opacity": 0.26,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.9,
        "circle-pitch-alignment": "viewport",
      },
    },
    {
      id: OBSERVED_POSITION_POINT_LAYER_ID,
      type: "circle",
      source: OBSERVED_POSITION_SOURCE_ID,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 5.5],
        "circle-color": ACCENT,
        "circle-opacity": 1,
        "circle-stroke-color": "#0b3f47",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.28,
        "circle-pitch-alignment": "viewport",
      },
    },
  ];
}
