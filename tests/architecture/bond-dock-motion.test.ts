// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const siteMain = readFileSync(
  resolve(process.cwd(), "apps/site/src/main.tsx"),
  "utf8",
);
const motionCss = readFileSync(
  resolve(process.cwd(), "apps/site/src/bond-dock-motion.css"),
  "utf8",
);

describe("Bond dock motion level 1", () => {
  it("loads the motion layer in the canonical site host", () => {
    expect(siteMain).toContain('import "./bond-dock-motion.css";');
  });

  it("animates the persistent surface and incoming screen content", () => {
    expect(motionCss).toContain(".bond-dock {");
    expect(motionCss).toContain("width var(--bond-motion-surface)");
    expect(motionCss).toContain("bond-dock-detail-content-enter");
    expect(motionCss).toContain("bond-dock-row-enter");
    expect(motionCss).toContain("transform-origin: left bottom");
  });

  it("keeps reduced-motion behavior explicit", () => {
    expect(motionCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(motionCss).toContain("animation-duration: 1ms !important");
    expect(motionCss).toContain("transition-duration: 1ms !important");
  });

  it("does not animate or remount the map renderer surface", () => {
    expect(motionCss).not.toContain(".authenticated-map-home__map");
    expect(motionCss).not.toContain("view-transition-name");
    expect(motionCss).not.toContain("startViewTransition");
  });
});
