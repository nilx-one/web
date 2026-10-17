// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRoute } from "@nilx-one/map-contract";

export const ROUTE_SOURCE_ID = "route";
export const ROUTE_CASING_LAYER_ID = "route-casing";
export const ROUTE_LINE_LAYER_ID = "route-line";

const LINE = "#37d7e5";
const CASING = "#0b1a22";

/** One line from the first point to the last; fewer than two draw nothing. */
export function routeData(route: MapRoute): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features:
      route.points.length < 2
        ? []
        : [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: route.points.map(([longitude, latitude]) => [
                  longitude,
                  latitude,
                ]),
              },
            },
          ],
  };
}

export function routeSource(route: MapRoute): Record<string, unknown> {
  return { type: "geojson", data: routeData(route) };
}

/** A width that grows with the zoom, so the route reads at every scale. */
function byZoom(at12: number, at16: number, at20: number): unknown[] {
  return ["interpolate", ["linear"], ["zoom"], 12, at12, 16, at16, 20, at20];
}

/**
 * A dash-dot line in the spatial accent over a soft dark casing, so it
 * stays legible on light ground, dark ground and the roofs it crosses.
 */
export function routeLayers(): readonly Record<string, unknown>[] {
  return [
    {
      id: ROUTE_CASING_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": CASING,
        "line-opacity": 0.35,
        "line-width": byZoom(7, 11, 18),
        "line-blur": 1,
      },
    },
    {
      id: ROUTE_LINE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      layout: { "line-join": "round", "line-cap": "butt" },
      paint: {
        "line-color": LINE,
        "line-width": byZoom(3.5, 6, 10),
        // Dash, gap, dot, gap: in multiples of the line's own width.
        "line-dasharray": [4, 1.6, 0.8, 1.6],
      },
    },
  ];
}
