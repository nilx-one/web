// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Linear 0..1 RGB, the shape a shader uniform takes. */
export type FogColor = readonly [number, number, number];

/**
 * How a stretch of fog is lit. Presentation only: a palette says what the
 * mist looks like, never who has been there or what happened in it.
 */
export interface FogPalette {
  /** The mist's underside: the valleys between cloud masses. */
  readonly shadow: FogColor;
  /** The mist's sunlit tops. */
  readonly light: FogColor;
  /** Light held inside the mist: the frontier's rim and the motes. */
  readonly glow: FogColor;
  /**
   * How much of that glow spills past the mist as added light, 0..1. Added
   * light reads on a dark map and washes out to nothing on a light one, so a
   * light palette keeps it at 0 and lets the glow tint the mist instead.
   */
  readonly bloom: number;
}

/**
 * A stretch of fog wearing its own palette. A zone is a circle on the ground
 * whose edge dissolves into the surrounding fog over `featherM`, broken up by
 * the same mist that drifts across it, so no zone ever ends on a drawn line.
 * Zones are presentation only: a colour says nothing about who was there.
 */
export interface FogZone {
  readonly id: string;
  readonly center: { readonly lng: number; readonly lat: number };
  /** Fully this zone's palette inside this radius, in metres. */
  readonly radiusM: number;
  /** How far past `radiusM` the zone takes to fade out, in metres. */
  readonly featherM?: number;
  readonly palette: FogPalette;
}

/** How many zones one shade layer blends at once. Bounded by shader uniforms. */
export const MAX_FOG_ZONES = 8;

/** A zone's default fade into the fog around it. */
export const DEFAULT_FOG_ZONE_FEATHER_M = 240;

/** `#rrggbb` to a shader colour. */
export function fogColor(hex: string): FogColor {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match === null) {
    throw new Error(`map-shade fog colour must be #rrggbb, got ${hex}`);
  }
  const value = Number.parseInt(match[1] ?? "", 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

/**
 * The mist around the Motherland on a bright morning: steel-azure valleys,
 * near-white sunlit tops, and cyan light caught inside. Cool enough that the
 * near-white ground a Bond has revealed still reads as ground, not as more
 * fog, and dense enough that the map beneath stays hidden.
 */
export const LIGHT_FOG_PALETTE: FogPalette = {
  shadow: fogColor("#90afc3"),
  light: fogColor("#f3fafd"),
  glow: fogColor("#2fcfe6"),
  bloom: 0,
};

/**
 * The same mist at night: a moonlit deep teal over the dark map, whose cyan
 * glow is allowed to spill out as light because there is dark to spill into.
 */
export const DARK_FOG_PALETTE: FogPalette = {
  shadow: fogColor("#061116"),
  light: fogColor("#29434f"),
  glow: fogColor("#37d7e5"),
  bloom: 0.55,
};

export const FOG_PALETTES = {
  light: LIGHT_FOG_PALETTE,
  dark: DARK_FOG_PALETTE,
} as const satisfies Record<"light" | "dark", FogPalette>;

const APPEARANCE_METADATA_KEY = "nilx-one:appearance";

/**
 * Which appearance a published style declares. The 0x1 style contract names
 * it in its metadata; anything else is read as light, the primary reference.
 */
export function styleAppearance(
  style: { readonly metadata?: unknown } | undefined,
): "light" | "dark" {
  const metadata = style?.metadata;
  if (typeof metadata !== "object" || metadata === null) return "light";
  return (metadata as Record<string, unknown>)[APPEARANCE_METADATA_KEY] ===
    "dark"
    ? "dark"
    : "light";
}

function requireUnitColor(color: FogColor, label: string): void {
  if (
    color.length !== 3 ||
    !color.every(
      (channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1,
    )
  ) {
    throw new Error(`map-shade ${label} must be three channels in 0..1`);
  }
}

/** Fails once, at the seam, instead of drawing NaN into every fragment. */
export function requireFogPalette(palette: FogPalette, label: string): void {
  requireUnitColor(palette.shadow, `${label}.shadow`);
  requireUnitColor(palette.light, `${label}.light`);
  requireUnitColor(palette.glow, `${label}.glow`);
  if (
    !Number.isFinite(palette.bloom) ||
    palette.bloom < 0 ||
    palette.bloom > 1
  ) {
    throw new Error(`map-shade ${label}.bloom must be in 0..1`);
  }
}

export function requireFogZones(zones: readonly FogZone[]): void {
  if (zones.length > MAX_FOG_ZONES) {
    throw new Error(
      `map-shade blends at most ${MAX_FOG_ZONES} fog zones, got ${zones.length}`,
    );
  }
  for (const zone of zones) {
    const label = `fog zone ${zone.id}`;
    if (
      !Number.isFinite(zone.center.lng) ||
      !Number.isFinite(zone.center.lat)
    ) {
      throw new Error(`map-shade ${label} needs a finite centre`);
    }
    if (!Number.isFinite(zone.radiusM) || zone.radiusM <= 0) {
      throw new Error(`map-shade ${label} radiusM must be positive`);
    }
    const feather = zone.featherM ?? DEFAULT_FOG_ZONE_FEATHER_M;
    if (!Number.isFinite(feather) || feather < 0) {
      throw new Error(`map-shade ${label} featherM must not be negative`);
    }
    requireFogPalette(zone.palette, `${label} palette`);
  }
}
