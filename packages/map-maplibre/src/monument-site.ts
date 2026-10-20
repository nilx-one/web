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
 * The museum's stepped terraces round the statue: every part of the complex
 * low enough to walk on, within this distance of the statue's point. In the
 * archive's data that is the complex and nothing else — the nearest other
 * building that low stands well beyond it.
 */
export const MOTHERLAND_TERRACE_RADIUS_METERS = 60;
export const MOTHERLAND_TERRACE_MAX_HEIGHT_METERS = 14;

/**
 * True for a `buildings` feature that is the monument's own ground: drawn
 * by its own layer in the colour of the land around, not as a building.
 */
export const MOTHERLAND_TERRACES: ExpressionSpecification = [
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
    MOTHERLAND_TERRACE_RADIUS_METERS,
  ],
  [
    "<=",
    ["coalesce", ["get", "height"], 7],
    MOTHERLAND_TERRACE_MAX_HEIGHT_METERS,
  ],
];

/** The terraces' stone, as the land around them is drawn in each theme. */
export const MOTHERLAND_TERRACE_COLORS = {
  light: "#e2e9e7",
  dark: "#15262b",
} as const;

/**
 * `filter` with the statue cut out of it. Idempotent: a filter that already
 * carries the cut-out is returned as it is, so re-applying presentation
 * after a style swap never nests it twice.
 */
export function withoutMotherland(
  filter: FilterSpecification | null | undefined | void,
): FilterSpecification {
  return without(filter, MOTHERLAND_CUTOUT);
}

export function carriesMotherlandCutout(filter: unknown): boolean {
  return carries(filter, MOTHERLAND_CUTOUT);
}

/** `filter` with the terraces taken out, for the generic buildings layer. */
export function withoutMotherlandTerraces(
  filter: FilterSpecification | null | undefined | void,
): FilterSpecification {
  return without(filter, MOTHERLAND_TERRACES);
}

export function carriesMotherlandTerraces(filter: unknown): boolean {
  return carries(filter, MOTHERLAND_TERRACES);
}

/**
 * The terraces' own filter: what the style's buildings filter admits, less
 * anything this module took out of it, and only the terraces.
 */
export function onlyMotherlandTerraces(
  filter: FilterSpecification | null | undefined | void,
): FilterSpecification {
  const style = styleFilter(filter);
  return style === undefined
    ? MOTHERLAND_TERRACES
    : ["all", style as ExpressionSpecification, MOTHERLAND_TERRACES];
}

const OWN = [MOTHERLAND_CUTOUT, MOTHERLAND_TERRACES].map((cut) =>
  JSON.stringify(["!", cut]),
);

/** The style's own filter, with this module's exclusions taken back out. */
function styleFilter(filter: unknown): unknown {
  if (filter === undefined || filter === null) return undefined;
  if (!Array.isArray(filter) || filter[0] !== "all") return filter;
  if (!filter.slice(1).some((part) => OWN.includes(JSON.stringify(part)))) {
    return filter;
  }
  const rest = filter
    .slice(1)
    .filter((part) => !OWN.includes(JSON.stringify(part)));
  return rest.length === 0
    ? undefined
    : rest.length === 1
      ? rest[0]
      : ["all", ...rest];
}

function without(
  filter: FilterSpecification | null | undefined | void,
  cut: ExpressionSpecification,
): FilterSpecification {
  const keep: ExpressionSpecification = ["!", cut];
  if (filter === undefined || filter === null) return keep;
  if (carries(filter, cut)) return filter;
  // One flat "all", however many exclusions join it, so each stays findable.
  if (Array.isArray(filter) && filter[0] === "all") {
    return [...(filter as unknown[]), keep] as unknown as FilterSpecification;
  }
  return ["all", filter as ExpressionSpecification, keep];
}

function carries(filter: unknown, cut: ExpressionSpecification): boolean {
  if (!Array.isArray(filter) || filter[0] !== "all") return false;
  const wanted = JSON.stringify(["!", cut]);
  return filter.slice(1).some((part) => JSON.stringify(part) === wanted);
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
