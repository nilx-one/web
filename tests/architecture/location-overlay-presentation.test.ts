// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const controlCss = read(
  "packages/product-app/src/features/map/location-control.css",
);
const observedPosition = read("packages/map-maplibre/src/observed-position.ts");

describe("location control presentation", () => {
  it("never leaves state to the accent colour alone", () => {
    // Every state that changes the accent also changes the glyph's shape, so
    // the control is readable without colour perception.
    expect(controlCss).toContain('[data-state="centered"]');
    expect(controlCss).toContain('[data-state="displaced"]');
    expect(controlCss).toContain("border-style: dotted");
    expect(controlCss).toContain("border-style: dashed");
  });

  it("keeps a visible focus indicator", () => {
    expect(controlCss).toContain(":focus-visible");
    expect(controlCss).toContain("outline:");
  });

  it("drops the locating pulse under reduced motion", () => {
    expect(controlCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(controlCss).toContain("animation: none");
  });

  it("stays clear of the bottom layer instead of covering the Dock", () => {
    expect(controlCss).toContain("var(--shell-bottom-height, 0px)");
    expect(controlCss).toContain("var(--safe-bottom, 0px)");
  });
});

describe("observed position overlay", () => {
  it("draws a static marker that needs no animation to be understood", () => {
    expect(observedPosition).not.toContain("animation");
    expect(observedPosition).not.toContain("transition");
  });

  it("keeps the exact point legible over pale close-zoom buildings", () => {
    // A white stroke around the accent core is what separates the point from
    // near-white building faces without adding a heavier marker.
    expect(observedPosition).toContain('"circle-stroke-color": "#ffffff"');
    expect(observedPosition).toContain("#37d7e5");
  });

  it("clamps a pathological accuracy for presentation without rewriting it", () => {
    expect(observedPosition).toContain("clampAccuracyMeters");
    // The clamp shapes the halo. The point geometry is always the observation.
    expect(observedPosition).toContain(
      "coordinates: [position.center[0], position.center[1]]",
    );
  });
});
