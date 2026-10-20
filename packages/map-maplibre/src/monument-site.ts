// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";

/**
 * Where Kyiv's Motherland Monument stands, and how much of the basemap the
 * procedural model takes over there. Kept apart from `monument-layer`, which
 * pulls in Three, so the renderer can cut the basemap's own statue out of
 * its extrusion and stand the model's plinth in as an obstacle without
 * loading the model's code.
 */

/**
 * The statue's own point: OpenStreetMap's `Батьківщина-Мати` artwork node,
 * on the axis of the drum the figure stands on — not the museum beneath it,
 * whose entrance sits some 40 m to the east.
 */
export const MOTHERLAND_MONUMENT_LOCATION: {
  readonly lng: number;
  readonly lat: number;
} = { lng: 30.56307, lat: 50.42655 };

/**
 * The way the figure faces, degrees clockwise from north. Read off the
 * basemap's own parts for the statue: the sword stands south-east of the
 * drum's axis and the shield north-west, so she faces the Dnipro, north-east.
 */
export const MOTHERLAND_MONUMENT_FACING_DEG = 49;

/** The model's plinth, at its widest: its footing ring. */
export const MOTHERLAND_PEDESTAL_RADIUS_METERS = 20;

/** How tall the plinth stands, to the figure's feet. */
export const MOTHERLAND_PEDESTAL_HEIGHT_METERS = 40;

/**
 * The basemap carries the statue as a stack of building parts: the drum and
 * its buttresses (26.5–42 m), the figure (to 74 m) and the arms, sword and
 * shield floating above it. All of them lie within this distance of the
 * statue's point and stand taller than anything else there — the stepped
 * terraces around the drum stop at 13 m — so distance and height together
 * pick out exactly the statue.
 */
export const MOTHERLAND_CUTOUT_RADIUS_METERS = 18;
export const MOTHERLAND_CUTOUT_MIN_HEIGHT_METERS = 20;

/**
 * True for a `buildings` feature the model replaces. Folded into the
 * extrusion layer's filter, it keeps MapLibre from drawing a second, blocky
 * Motherland through the model; the flat footprints are left as they are.
 */
export const MOTHERLAND_CUTOUT: ExpressionSpecification = [
  "all",
  [
    "<=",
    [
      "distance",
      {
        type: "Point",
        coordinates: [
          MOTHERLAND_MONUMENT_LOCATION.lng,
          MOTHERLAND_MONUMENT_LOCATION.lat,
        ],
      },
    ],
    MOTHERLAND_CUTOUT_RADIUS_METERS,
  ],
  [
    ">",
    ["coalesce", ["get", "height"], 0],
    MOTHERLAND_CUTOUT_MIN_HEIGHT_METERS,
  ],
];

/**
 * `filter` with the statue cut out of it. Idempotent: a filter that already
 * carries the cut-out is returned as it is, so re-applying presentation
 * after a style swap never nests it twice.
 */
export function withoutMotherland(
  filter: FilterSpecification | null | undefined | void,
): FilterSpecification {
  if (filter !== undefined && filter !== null) {
    if (carriesMotherlandCutout(filter)) return filter;
    return ["all", filter as ExpressionSpecification, keepMotherland()];
  }
  return keepMotherland();
}

function keepMotherland(): ExpressionSpecification {
  return ["!", MOTHERLAND_CUTOUT];
}

export function carriesMotherlandCutout(filter: unknown): boolean {
  if (!Array.isArray(filter) || filter[0] !== "all") return false;
  const last: unknown = filter[filter.length - 1];
  return (
    Array.isArray(last) &&
    last[0] === "!" &&
    JSON.stringify(last[1]) === JSON.stringify(MOTHERLAND_CUTOUT)
  );
}

/**
 * The plinth's footprint as a ring of [longitude, latitude], closed. It is
 * what a body walks around once the basemap's drum is cut out: the model
 * stands where the drum stood, and is just as solid.
 */
export function motherlandPedestalRing(
  sides = 32,
): readonly (readonly [number, number])[] {
  const { lng, lat } = MOTHERLAND_MONUMENT_LOCATION;
  const metresPerDegree = 111_195;
  const dLat = MOTHERLAND_PEDESTAL_RADIUS_METERS / metresPerDegree;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const ring: (readonly [number, number])[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides;
    ring.push([lng + dLng * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  ring.push(ring[0]!);
  return ring;
}
