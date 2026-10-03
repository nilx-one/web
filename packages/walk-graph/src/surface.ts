// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What a walking edge is made of, as far as the archive can tell.
 *
 * The Protomaps `roads` layer carries `kind` and the raw OSM highway value as
 * `kind_detail`, but not sidewalks. "Street with a sidewalk" and "carriageway
 * without one" from the outings plan (§0.3) therefore become a stand-in: minor
 * and medium roads walk as streets, major roads as carriageways, and highways are
 * not walked along at all. Highways are still crossed where another walkable line
 * meets them, because that crossing is a shared node, not a highway edge.
 */
export type Surface = "footway" | "track" | "steps" | "street" | "carriageway";

/** Cost of one metre on each surface. Starting values, tuned on live walking. */
export const SURFACE_WEIGHT: Readonly<Record<Surface, number>> = {
  footway: 1.0,
  track: 1.3,
  steps: 2.0,
  street: 1.5,
  carriageway: 3.0,
};

/**
 * Cost of one metre of grass. Not a graph edge: grass connectors are drawn by
 * the router's caller between a point and the graph, and are priced with this.
 */
export const GRASS_WEIGHT = 4.0;

const BY_KIND_DETAIL: Readonly<Record<string, Surface | null>> = {
  footway: "footway",
  path: "footway",
  pedestrian: "footway",
  corridor: "footway",
  track: "track",
  cycleway: "track",
  bridleway: "track",
  steps: "steps",
  living_street: "street",
  residential: "street",
  service: "street",
  unclassified: "street",
  road: "street",
  tertiary: "street",
  tertiary_link: "street",
  secondary: "carriageway",
  secondary_link: "carriageway",
  primary: "carriageway",
  primary_link: "carriageway",
  trunk: null,
  trunk_link: null,
  motorway: null,
  motorway_link: null,
  construction: null,
  proposed: null,
  raceway: null,
  bus_guideway: null,
  busway: null,
  platform: null,
};

const BY_KIND: Readonly<Record<string, Surface | null>> = {
  path: "footway",
  minor_road: "street",
  medium_road: "street",
  major_road: "carriageway",
  highway: null,
};

/**
 * Classify one `roads` feature. `null` means it is not walked along: highways,
 * rail, ferries, aerialways, and anything the table does not know. An unknown
 * `kind_detail` falls back to `kind`; an unknown `kind` is never walkable.
 */
export function surfaceOf(
  kind: string,
  kindDetail?: string | undefined,
): Surface | null {
  if (!Object.hasOwn(BY_KIND, kind) || BY_KIND[kind] === null) return null;
  if (kindDetail !== undefined && Object.hasOwn(BY_KIND_DETAIL, kindDetail)) {
    return BY_KIND_DETAIL[kindDetail] ?? null;
  }
  return BY_KIND[kind] ?? null;
}
