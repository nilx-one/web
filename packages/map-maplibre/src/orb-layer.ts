// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { FLIGHT_LOOT_COLORS, type MapOrb } from "@nilx-one/map-contract";

export const ORBS_SOURCE_ID = "orbs";
export const ORBS_GLOW_LAYER_ID = "orbs-glow";
export const ORBS_CORE_LAYER_ID = "orbs-core";
export const ORBS_GOAL_LAYER_ID = "orbs-goal";

/** How long an orb takes to fall, ending at its `landsAt`. */
export const ORB_FALL_MS = 650;

/** How long a picked-up orb takes to reach whoever picked it up. */
export const ORB_PULL_MS = 320;

const CORE = "#f2fdff";
const GLOW = "#7fe6ff";
const GOAL = "#37d7e5";

/**
 * How far an orb has come at `nowMs`: 0 before it starts to fall, 1 once it
 * lies still. Past the ground it overshoots a little and settles back, the
 * way something dropped does.
 */
export function orbFall(orb: Pick<MapOrb, "landsAt">, nowMs: number): number {
  const t = (nowMs - (orb.landsAt - ORB_FALL_MS)) / ORB_FALL_MS;
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  // An ease-out with one soft bounce: up to about 1.15, back to 1.
  const back = 2.2;
  const u = t - 1;
  return 1 + (back + 1) * u * u * u + back * u * u;
}

/**
 * How far a picked-up orb has been drawn in at `nowMs`: 0 where it lay, 1
 * at whoever picked it up. It speeds up as it goes, the way a magnet pulls.
 */
export function orbPull(orb: Pick<MapOrb, "pulledTo">, nowMs: number): number {
  if (orb.pulledTo === undefined) return 0;
  const t = (nowMs - orb.pulledTo.at) / ORB_PULL_MS;
  if (!(t > 0)) return 0;
  return t >= 1 ? 1 : t * t;
}

/** Whether any orb is still to land or still being drawn in. */
export function orbsFalling(orbs: readonly MapOrb[], nowMs: number): boolean {
  return orbs.some(
    (orb) =>
      orb.landsAt > nowMs ||
      (orb.pulledTo !== undefined && orbPull(orb, nowMs) < 1),
  );
}

/** A rarity's colour as a CSS hex string, the flight loot's own. */
function rarityColor(orb: Pick<MapOrb, "rarity">): string {
  return orb.rarity === undefined
    ? GLOW
    : `#${FLIGHT_LOOT_COLORS[orb.rarity].toString(16).padStart(6, "0")}`;
}

/**
 * One point per orb. Its properties are presentation only: what it is and
 * how far it has fallen. An orb that has not started falling is not drawn.
 */
export function orbsData(
  orbs: readonly MapOrb[],
  nowMs: number,
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: orbs.flatMap((orb) => {
      const fall = orbFall(orb, nowMs);
      const pull = orbPull(orb, nowMs);
      if (fall <= 0 || pull >= 1) return [];
      const to = orb.pulledTo;
      const longitude =
        to === undefined
          ? orb.longitude
          : orb.longitude + (to.longitude - orb.longitude) * pull;
      const latitude =
        to === undefined
          ? orb.latitude
          : orb.latitude + (to.latitude - orb.latitude) * pull;
      return [
        {
          type: "Feature",
          properties: {
            kind: orb.kind,
            // Drawn in, it shrinks to nothing as it arrives.
            scale: Math.max(0, fall) * (1 - pull),
            // The glow starts wide and closes in as the orb lands.
            spread: 1 + 2.5 * Math.max(0, 1 - fall),
            opacity: Math.min(1, fall * 1.4),
            color: rarityColor(orb),
          },
          geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
        },
      ];
    }),
  };
}

export function orbsSource(
  orbs: readonly MapOrb[],
  nowMs: number,
): Record<string, unknown> {
  return { type: "geojson", data: orbsData(orbs, nowMs) };
}

/** A size that grows with the zoom, scaled by a feature property. */
function byZoom(
  at14: number,
  at17: number,
  at19: number,
  property: string,
): unknown[] {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    14,
    ["*", at14, ["get", property]],
    17,
    ["*", at17, ["get", property]],
    19,
    ["*", at19, ["get", property]],
  ];
}

/**
 * Orbs are small bright beads with a soft halo, lying flat on the ground so
 * a tilted world foreshortens them like everything else on it; the find at
 * the end of a trail is a ring in the spatial accent.
 */
export function orbsLayers(): readonly Record<string, unknown>[] {
  const isOrb = ["==", ["get", "kind"], "orb"];
  return [
    {
      id: ORBS_GLOW_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: isOrb,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": byZoom(4, 9, 16, "spread"),
        "circle-blur": 0.9,
        "circle-opacity": ["*", 0.55, ["get", "opacity"]],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: ORBS_CORE_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: isOrb,
      paint: {
        "circle-color": CORE,
        "circle-radius": byZoom(1.6, 3.4, 6, "scale"),
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1,
        "circle-stroke-opacity": ["get", "opacity"],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: ORBS_GOAL_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: ["==", ["get", "kind"], "goal"],
      paint: {
        "circle-color": GOAL,
        "circle-opacity": ["*", 0.18, ["get", "opacity"]],
        "circle-radius": byZoom(4, 10, 18, "scale"),
        "circle-stroke-color": GOAL,
        "circle-stroke-width": 2,
        "circle-stroke-opacity": ["*", 0.9, ["get", "opacity"]],
        "circle-pitch-alignment": "map",
      },
    },
  ];
}
