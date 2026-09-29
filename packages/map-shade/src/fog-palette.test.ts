// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  DARK_FOG_PALETTE,
  FOG_PALETTES,
  LIGHT_FOG_PALETTE,
  MAX_FOG_ZONES,
  fogColor,
  requireFogPalette,
  requireFogZones,
  styleAppearance,
  type FogZone,
} from "./fog-palette";

const zone: FogZone = {
  id: "motherland",
  center: { lng: 30.5634, lat: 50.4265 },
  radiusM: 300,
  palette: LIGHT_FOG_PALETTE,
};

describe("fog colours", () => {
  it("reads #rrggbb into shader channels", () => {
    expect(fogColor("#ff8000")).toEqual([1, 128 / 255, 0]);
    expect(fogColor("#00D8F2")).toEqual([0, 216 / 255, 242 / 255]);
  });

  it.each(["ff8000", "#f80", "#ff80000", "cyan"])(
    "refuses %s rather than guessing",
    (hex) => {
      expect(() => fogColor(hex)).toThrow(/must be #rrggbb/);
    },
  );

  it("publishes palettes the shade layer accepts", () => {
    for (const palette of Object.values(FOG_PALETTES)) {
      expect(() => requireFogPalette(palette, "palette")).not.toThrow();
    }
    // A light map washes added light out to nothing; only dark lets it bloom.
    expect(LIGHT_FOG_PALETTE.bloom).toBe(0);
    expect(DARK_FOG_PALETTE.bloom).toBeGreaterThan(0);
  });
});

describe("style appearance", () => {
  it("follows the appearance the published style declares", () => {
    expect(
      styleAppearance({ metadata: { "nilx-one:appearance": "dark" } }),
    ).toBe("dark");
    expect(
      styleAppearance({ metadata: { "nilx-one:appearance": "light" } }),
    ).toBe("light");
  });

  it("reads anything it cannot place as light, the primary reference", () => {
    expect(styleAppearance(undefined)).toBe("light");
    expect(styleAppearance({})).toBe("light");
    expect(styleAppearance({ metadata: null })).toBe("light");
    expect(
      styleAppearance({ metadata: { "nilx-one:appearance": "dusk" } }),
    ).toBe("light");
  });
});

describe("fog zones", () => {
  it("accepts up to the zones one layer blends", () => {
    const zones = Array.from({ length: MAX_FOG_ZONES }, (_, index) => ({
      ...zone,
      id: `zone-${index}`,
    }));
    expect(() => requireFogZones(zones)).not.toThrow();
    expect(() => requireFogZones([...zones, zone])).toThrow(
      /at most 8 fog zones, got 9/,
    );
  });

  it.each([
    [{ radiusM: 0 }, /radiusM must be positive/],
    [{ radiusM: Number.NaN }, /radiusM must be positive/],
    [{ featherM: -1 }, /featherM must not be negative/],
    [{ center: { lng: Number.NaN, lat: 50 } }, /needs a finite centre/],
    [
      { palette: { ...LIGHT_FOG_PALETTE, glow: [0, 1.2, 0] as const } },
      /glow must be three channels in 0\.\.1/,
    ],
    [
      { palette: { ...LIGHT_FOG_PALETTE, bloom: 2 } },
      /bloom must be in 0\.\.1/,
    ],
  ] as const)("refuses a zone with %o", (change, message) => {
    expect(() => requireFogZones([{ ...zone, ...change }])).toThrow(message);
  });
});
