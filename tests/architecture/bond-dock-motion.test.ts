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
const windowCss = readFileSync(
  resolve(process.cwd(), "packages/product-app/src/shell/dock-window.css"),
  "utf8",
);
const windowSource = readFileSync(
  resolve(process.cwd(), "packages/product-app/src/shell/dock-window.tsx"),
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

describe("Bond dock motion level 2: the navigated window", () => {
  it("moves a screen change as a from-to pair, not a replacement", () => {
    for (const phase of ['[data-phase="from"]', '[data-phase="to"]']) {
      expect(windowCss).toContain(phase);
    }
    for (const move of [
      "bond-dock-screen-push-in",
      "bond-dock-screen-push-out",
      "bond-dock-screen-pop-in",
      "bond-dock-screen-pop-out",
    ]) {
      expect(windowCss).toContain(`@keyframes ${move}`);
    }
  });

  it("travels between the two heights the pair actually has", () => {
    expect(windowCss).toContain(
      "transition: height var(--dock-window-duration)",
    );
    expect(windowSource).toContain("element.style.height = `${to}px`");
    // Depth is told to the window, never inferred from the screen's name.
    expect(windowSource).toContain("depth < settled.depth");
  });

  it("puts the screen being left out of reach while it leaves", () => {
    expect(windowSource).toContain('aria-hidden="true"');
    expect(windowSource).toContain("inert");
  });

  it("keeps reduced motion and unmeasured layout on the settled path", () => {
    expect(windowCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(windowSource).toContain("prefersReducedMotion()");
    expect(windowSource).toContain("from === 0 || to === 0");
  });

  it("stays inside the Dock and off the persistent world", () => {
    expect(windowCss).not.toContain(".authenticated-map-home__map");
    expect(windowCss).not.toContain("view-transition-name");
    expect(windowSource).not.toContain("startViewTransition");
  });
});
