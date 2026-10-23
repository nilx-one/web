// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  FLIGHT_LOOT_COLORS,
  type FlightLootRarity,
  type MapOrb,
} from "@nilx-one/map-contract";

import { ORB_COLLECT_MS } from "./orb-flight";

export const ORBS_SOURCE_ID = "orbs";
export const ORBS_AURA_LAYER_ID = "orbs-aura";
export const ORBS_GLOW_LAYER_ID = "orbs-glow";
export const ORBS_CORE_LAYER_ID = "orbs-core";
export const ORBS_GOAL_LAYER_ID = "orbs-goal";

/** How long an orb takes to fall, ending at its `landsAt`. */
export const ORB_FALL_MS = 650;

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

/** How large an orb shines against a Common one. */
export function orbShineSize(orb: Pick<MapOrb, "rarity">): number {
  return SHINE[orb.rarity ?? "common"].size;
}

function hex(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/** A rarity's colour as a CSS hex string, the flight loot's own. */
export function orbColor(orb: Pick<MapOrb, "rarity">): string {
  return orb.rarity === undefined ? GLOW : hex(FLIGHT_LOOT_COLORS[orb.rarity]);
}

/** The bead's own fill: its rarity's colour, lit nearly white. */
export function orbCoreColor(orb: Pick<MapOrb, "rarity">): string {
  if (orb.rarity === undefined) return CORE;
  const rgb = FLIGHT_LOOT_COLORS[orb.rarity];
  const lit = (shift: number) => {
    const channel = (rgb >> shift) & 0xff;
    return Math.round(channel + (0xff - channel) * 0.55) << shift;
  };
  return hex(lit(16) | lit(8) | lit(0));
}

/** A stable number in [0, 1) for an orb, so neighbours do not move as one. */
export function orbSeed(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) / 2 ** 32;
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

/**
 * A picked-up orb on the ground: it lies until it leaves, then the flight
 * overlay carries it (`orb-flight.ts`). With reduced motion there is no
 * flight; it only fades where it lay.
 */
function collected(
  orb: MapOrb,
  to: NonNullable<MapOrb["pulledTo"]>,
  shine: Shine,
  nowMs: number,
  reducedMotion: boolean,
): Feature[] {
  const fade = reducedMotion ? 1 - (nowMs - to.at) / ORB_FADE_MS : 1;
  if (!(fade > 0) || (!reducedMotion && nowMs >= to.at)) return [];
  return [
    point([orb.longitude, orb.latitude], {
      kind: "orb",
      scale: 1,
      spread: shine.size,
      glow: shine.glow,
      aura: reducedMotion ? 0 : shine.aura,
      opacity: Math.min(1, fade),
      color: orbColor(orb),
      core: orbCoreColor(orb),
    }),
  ];
}

/**
 * One point per orb on the ground. Its properties are presentation only:
 * what it is, how far it has fallen, how it shines. An orb that has not
 * started falling, or has left for its picker, is not drawn.
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
            (2 * Math.PI * nowMs) / shine.period +
              2 * Math.PI * orbSeed(orb.id),
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
          color: orbColor(orb),
          core: orbCoreColor(orb),
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
 * it. The find at the end of a trail is a ring in the spatial accent.
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
