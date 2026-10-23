// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  FLIGHT_LOOT_COLORS,
  type FlightLootRarity,
  type MapOrb,
} from "@nilx-one/map-contract";

export const ORBS_SOURCE_ID = "orbs";
export const ORBS_AURA_LAYER_ID = "orbs-aura";
export const ORBS_GLOW_LAYER_ID = "orbs-glow";
export const ORBS_CORE_LAYER_ID = "orbs-core";
export const ORBS_BURST_LAYER_ID = "orbs-burst";
export const ORBS_GOAL_LAYER_ID = "orbs-goal";

/** How long an orb takes to fall, ending at its `landsAt`. */
export const ORB_FALL_MS = 650;

/** How long a picked-up orb hops up before it is drawn in. */
export const ORB_LIFT_MS = 160;

/** How long a picked-up orb then takes to reach whoever picked it up. */
export const ORB_PULL_MS = 520;

/** How long the flash lasts where it arrives. */
export const ORB_BURST_MS = 320;

/** A whole pick-up, from `pulledTo.at` until nothing of it is left. */
export const ORB_COLLECT_MS = ORB_LIFT_MS + ORB_PULL_MS + ORB_BURST_MS;

/** How long a picked-up orb fades where it lay, when motion is reduced. */
export const ORB_FADE_MS = 200;

/** How often a lying orb's glow is redrawn while nothing else moves. */
export const ORB_GLOW_FRAME_MS = 90;

const CORE = "#f2fdff";
const GLOW = "#7fe6ff";
const GOAL = "#37d7e5";

/** How brightly each rarity shines: rarer is wider, brighter and quicker. */
interface Shine {
  /** The glow's size against a Common orb's. */
  readonly size: number;
  /** The glow's opacity. */
  readonly glow: number;
  /** How far the glow breathes in and out, as a share of its size. */
  readonly breath: number;
  /** One breath, in milliseconds. */
  readonly period: number;
  /** The outer aura's size; 0 draws none. */
  readonly aura: number;
}

const SHINE: Readonly<Record<FlightLootRarity, Shine>> = Object.freeze({
  common: { size: 1, glow: 0.5, breath: 0.06, period: 2600, aura: 0 },
  uncommon: { size: 1.15, glow: 0.6, breath: 0.1, period: 2200, aura: 0 },
  rare: { size: 1.3, glow: 0.7, breath: 0.14, period: 1900, aura: 1 },
  special: { size: 1.5, glow: 0.78, breath: 0.18, period: 1650, aura: 1.3 },
  exclusive: { size: 1.75, glow: 0.85, breath: 0.24, period: 1400, aura: 1.7 },
});

/** How a renderer asks for orbs to be drawn. */
export interface OrbDrawOptions {
  /** No breathing, no arc and no trail: a picked-up orb just fades. */
  readonly reducedMotion?: boolean;
}

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
 * How far a picked-up orb has been drawn in at `nowMs`: 0 where it lay,
 * through its hop, 1 at whoever picked it up. It draws back a hair first and
 * then speeds up as it goes, the way a magnet pulls.
 */
export function orbPull(orb: Pick<MapOrb, "pulledTo">, nowMs: number): number {
  if (orb.pulledTo === undefined) return 0;
  const t = (nowMs - orb.pulledTo.at - ORB_LIFT_MS) / ORB_PULL_MS;
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (1.6 * t - 0.6);
}

/** How far a picked-up orb's hop has gone: 0 to 1, then 1. */
function orbLift(orb: Pick<MapOrb, "pulledTo">, nowMs: number): number {
  if (orb.pulledTo === undefined) return 0;
  const t = (nowMs - orb.pulledTo.at) / ORB_LIFT_MS;
  if (!(t > 0)) return 0;
  return t >= 1 ? 1 : 1 - (1 - t) * (1 - t);
}

/** How far the arrival flash has gone: 0 until the orb arrives, then to 1. */
function orbBurst(orb: Pick<MapOrb, "pulledTo">, nowMs: number): number {
  if (orb.pulledTo === undefined) return 0;
  const t =
    (nowMs - orb.pulledTo.at - ORB_LIFT_MS - ORB_PULL_MS) / ORB_BURST_MS;
  if (!(t > 0)) return 0;
  return Math.min(1, t);
}

/** Whether any orb is still to land or still being picked up. */
export function orbsFalling(
  orbs: readonly MapOrb[],
  nowMs: number,
  options: OrbDrawOptions = {},
): boolean {
  const collect = options.reducedMotion === true ? ORB_FADE_MS : ORB_COLLECT_MS;
  return orbs.some(
    (orb) =>
      orb.landsAt > nowMs ||
      (orb.pulledTo !== undefined && nowMs < orb.pulledTo.at + collect),
  );
}

/** Whether any orb lies on the ground, breathing its rarity's glow. */
export function orbsGlowing(
  orbs: readonly MapOrb[],
  options: OrbDrawOptions = {},
): boolean {
  return (
    options.reducedMotion !== true &&
    orbs.some((orb) => orb.kind === "orb" && orb.pulledTo === undefined)
  );
}

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/** A rarity's colour as a CSS hex string, the flight loot's own. */
function rarityColor(orb: Pick<MapOrb, "rarity">): string {
  return orb.rarity === undefined ? GLOW : hex(FLIGHT_LOOT_COLORS[orb.rarity]);
}

/** The bead's own fill: its rarity's colour, lit nearly white. */
function coreColor(orb: Pick<MapOrb, "rarity">): string {
  if (orb.rarity === undefined) return CORE;
  const rgb = FLIGHT_LOOT_COLORS[orb.rarity];
  const lit = (shift: number) => {
    const channel = (rgb >> shift) & 0xff;
    return Math.round(channel + (0xff - channel) * 0.55) << shift;
  };
  return hex(lit(16) | lit(8) | lit(0));
}

/** A stable number in [0, 1) for an orb, so neighbours do not move as one. */
function seed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
}

/** Where a picked-up orb is at pull `s`: along a soft arc to its picker. */
function pulledPoint(
  orb: MapOrb,
  to: NonNullable<MapOrb["pulledTo"]>,
  s: number,
  arc: boolean,
): [number, number] {
  const longitude = orb.longitude + (to.longitude - orb.longitude) * s;
  const latitude = orb.latitude + (to.latitude - orb.latitude) * s;
  if (!arc) return [longitude, latitude];
  // Sideways from the straight line, in ground-true proportions, bulging
  // most halfway and to the side this orb's id picks.
  const cos = Math.max(0.01, Math.cos((orb.latitude * Math.PI) / 180));
  const dx = (to.longitude - orb.longitude) * cos;
  const dy = to.latitude - orb.latitude;
  const bulge =
    (seed(orb.id) < 0.5 ? -1 : 1) * 0.35 * Math.sin(Math.PI * Math.max(0, s));
  return [longitude + (-dy * bulge) / cos, latitude + dx * bulge];
}

type Feature = Record<string, unknown>;

function point(
  coordinates: [number, number],
  properties: Record<string, unknown>,
): Feature {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates },
  };
}

/** The features of one picked-up orb: its hop, its pull and its flash. */
function collected(
  orb: MapOrb,
  to: NonNullable<MapOrb["pulledTo"]>,
  shine: Shine,
  nowMs: number,
  reducedMotion: boolean,
): Feature[] {
  const color = rarityColor(orb);
  const core = coreColor(orb);
  if (reducedMotion) {
    const fade = 1 - (nowMs - to.at) / ORB_FADE_MS;
    if (!(fade > 0)) return [];
    return [
      point([orb.longitude, orb.latitude], {
        kind: "orb",
        scale: 1,
        spread: shine.size,
        glow: shine.glow,
        aura: 0,
        opacity: Math.min(1, fade),
        color,
        core,
      }),
    ];
  }
  const burst = orbBurst(orb, nowMs);
  if (burst >= 1) return [];
  if (burst > 0) {
    // Arrived: a ring of its colour opens and fades where the picker is.
    return [
      point([to.longitude, to.latitude], {
        kind: "burst",
        ring: (0.6 + 1.8 * (1 - (1 - burst) * (1 - burst))) * shine.size,
        opacity: 0.9 * (1 - burst),
        color,
      }),
    ];
  }
  const lift = orbLift(orb, nowMs);
  const pull = orbPull(orb, nowMs);
  // It swells as it hops, then shrinks on the way in.
  const scale = (1 + 0.45 * lift) * (1 - 0.55 * Math.max(0, pull));
  const spread = shine.size * (1 + 0.8 * lift - 0.6 * Math.max(0, pull));
  const features = [
    point(pulledPoint(orb, to, pull, true), {
      kind: "orb",
      scale,
      spread,
      glow: Math.min(1, shine.glow + 0.25 * lift),
      aura: shine.aura * (1 - Math.max(0, pull)),
      opacity: 1,
      color,
      core,
    }),
  ];
  // A short tail of fading beads behind it while it flies.
  if (pull > 0) {
    for (let step = 1; step <= 3; step += 1) {
      const behind = orbPull(orb, nowMs - (step * ORB_PULL_MS) / 14);
      if (behind <= 0) break;
      features.push(
        point(pulledPoint(orb, to, behind, true), {
          kind: "orb",
          scale: scale * (1 - step * 0.22),
          spread: spread * (1 - step * 0.2),
          glow: shine.glow,
          aura: 0,
          opacity: 0.55 - step * 0.15,
          color,
          core,
        }),
      );
    }
  }
  return features;
}

/**
 * One point per orb, plus its trail and flash while it is picked up. Its
 * properties are presentation only: what it is, how far it has fallen, how
 * it shines. An orb that has not started falling is not drawn.
 */
export function orbsData(
  orbs: readonly MapOrb[],
  nowMs: number,
  options: OrbDrawOptions = {},
): Record<string, unknown> {
  const reducedMotion = options.reducedMotion === true;
  return {
    type: "FeatureCollection",
    features: orbs.flatMap((orb) => {
      const fall = orbFall(orb, nowMs);
      if (fall <= 0) return [];
      const shine = SHINE[orb.rarity ?? "common"];
      const to = orb.pulledTo;
      if (to !== undefined && orb.kind === "orb") {
        return collected(orb, to, shine, nowMs, reducedMotion);
      }
      if (to !== undefined) return [];
      const breath = reducedMotion
        ? 0
        : shine.breath *
          Math.sin(
            (2 * Math.PI * nowMs) / shine.period + 2 * Math.PI * seed(orb.id),
          );
      return [
        point([orb.longitude, orb.latitude], {
          kind: orb.kind,
          scale: Math.max(0, fall),
          // The glow starts wide and closes in as the orb lands, then
          // breathes at its rarity's pace.
          spread: shine.size * (1 + breath) + 2.5 * Math.max(0, 1 - fall),
          glow: shine.glow,
          aura: shine.aura * (1 - breath),
          opacity: Math.min(1, fall * 1.4),
          color: rarityColor(orb),
          core: coreColor(orb),
        }),
      ];
    }),
  };
}

export function orbsSource(
  orbs: readonly MapOrb[],
  nowMs: number,
  options: OrbDrawOptions = {},
): Record<string, unknown> {
  return { type: "geojson", data: orbsData(orbs, nowMs, options) };
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
 * Orbs are bright beads lit in their rarity's colour, with a halo that
 * breathes at its pace and, from Rare up, a wide faint aura; they lie flat
 * on the ground so a tilted world foreshortens them like everything else on
 * it. A picked-up orb ends in a ring of its colour; the find at the end of a
 * trail is a ring in the spatial accent.
 */
export function orbsLayers(): readonly Record<string, unknown>[] {
  const isOrb = ["==", ["get", "kind"], "orb"];
  return [
    {
      id: ORBS_AURA_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: ["all", isOrb, [">", ["get", "aura"], 0]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": byZoom(9, 20, 34, "aura"),
        "circle-blur": 1,
        "circle-opacity": ["*", 0.22, ["get", "opacity"]],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: ORBS_GLOW_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: isOrb,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": byZoom(4, 9, 16, "spread"),
        "circle-blur": 0.9,
        "circle-opacity": ["*", ["get", "glow"], ["get", "opacity"]],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: ORBS_CORE_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: isOrb,
      paint: {
        "circle-color": ["get", "core"],
        "circle-radius": byZoom(1.6, 3.4, 6, "scale"),
        "circle-opacity": ["get", "opacity"],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": ["get", "opacity"],
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: ORBS_BURST_LAYER_ID,
      type: "circle",
      source: ORBS_SOURCE_ID,
      filter: ["==", ["get", "kind"], "burst"],
      paint: {
        "circle-color": ["get", "color"],
        "circle-opacity": ["*", 0.25, ["get", "opacity"]],
        "circle-radius": byZoom(4, 9, 16, "ring"),
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2,
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
