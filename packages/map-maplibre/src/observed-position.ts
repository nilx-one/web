// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { cellToBoundary, latLngToCell } from "h3-js";
import {
  mapMetersPerPixel,
  type MapObservedPosition,
} from "@nilx-one/map-contract";

export const OBSERVED_POSITION_SOURCE_ID = "observed-position";
export const OBSERVED_POSITION_ACCURACY_LAYER_ID = "observed-position-accuracy";
export const OBSERVED_POSITION_CELL_LAYER_ID = "observed-position-cell";
export const OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID =
  "observed-position-cell-outline";
export const OBSERVED_POSITION_EDGE_LAYER_ID = "observed-position-edge";
export const OBSERVED_POSITION_POINT_LAYER_ID = "observed-position-point";

/**
 * Presentation-only local cell. Resolution 12 has an average H3 edge length
 * of about 10.8 m, so the authenticated world shows a small spatial unit
 * around the observed device instead of the much larger persistent presence
 * cells. This does not change presence resolution or create a journal record.
 */
export const OBSERVED_POSITION_CELL_RESOLUTION = 12;

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

function observedPositionCellFeature(
  position: MapObservedPosition,
): Record<string, unknown> {
  const cell = latLngToCell(
    position.center[1],
    position.center[0],
    OBSERVED_POSITION_CELL_RESOLUTION,
  );
  const boundary = cellToBoundary(cell, true);
  const coordinates = boundary.map(([longitude, latitude]) => [
    longitude,
    latitude,
  ]);
  const first = coordinates[0];
  if (first !== undefined) coordinates.push([...first]);

  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  };
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
      features: [
        observedPositionCellFeature(position),
        observedPositionFeature(position),
      ],
    },
  };
}

/**
 * The local cell is paired with three restrained circles rather than a
 * conventional pin: the reported accuracy, a pale edge, and the exact
 * coordinate itself. The cell is a presentation boundary only; it is not a
 * persistent presence record.
 *
 * All point layers lie flat on the ground. The marker is always drawn, so a
 * body has to be able to stand on it: pitched into the viewport it would tilt
 * up into the figure and read as a disc pasted over its middle.
 */
export function observedPositionLayers(
  position: MapObservedPosition,
): readonly Record<string, unknown>[] {
  return [
    {
      id: OBSERVED_POSITION_CELL_LAYER_ID,
      type: "fill",
      source: OBSERVED_POSITION_SOURCE_ID,
      filter: ["==", "$type", "Polygon"],
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.12,
      },
    },
    {
      id: OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
      type: "line",
      source: OBSERVED_POSITION_SOURCE_ID,
      filter: ["==", "$type", "Polygon"],
      paint: {
        "line-color": ACCENT,
        "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 1, 19, 1.5],
      },
    },
    {
      id: OBSERVED_POSITION_ACCURACY_LAYER_ID,
      type: "circle",
      source: OBSERVED_POSITION_SOURCE_ID,
      filter: ["==", "$type", "Point"],
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
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 16, 10],
        "circle-color": ACCENT,
        "circle-opacity": 0.26,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-opacity": 0.9,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: OBSERVED_POSITION_POINT_LAYER_ID,
      type: "circle",
      source: OBSERVED_POSITION_SOURCE_ID,
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 5.5],
        "circle-color": ACCENT,
        "circle-opacity": 1,
        "circle-stroke-color": "#0b3f47",
        "circle-stroke-width": 1,
        "circle-stroke-opacity": 0.28,
        "circle-pitch-alignment": "map",
      },
    },
  ];
}
