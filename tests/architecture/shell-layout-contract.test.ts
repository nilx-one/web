// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

function stylesheet(relativePath: string): string {
  // Comments explain the rules; they are never part of what a rule declares.
  return read(relativePath).replace(/\/\*[\s\S]*?\*\//g, "");
}

const shellCss = stylesheet("packages/product-app/src/shell/app-shell.css");
const toastCss = stylesheet("packages/ui/src/styles.css");
const worldView = read(
  "packages/product-app/src/features/map/authenticated-map-home-view.tsx",
);
const productApp = read("packages/product-app/src/index.tsx");

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(
    new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([\\s\\S]*?)\\}`),
  );

  expect(match, `${selector} rule is required`).not.toBeNull();
  return match?.[1] ?? "";
}

function layerDepth(selector: string): number {
  const declaration = rule(shellCss, selector).match(/z-index:\s*(\d+)/);

  expect(declaration, `${selector} must declare its layer`).not.toBeNull();
  return Number(declaration?.[1]);
}

describe("shell layout contract", () => {
  it("keeps the Dock's lower edge attached to the bottom safe area", () => {
    const bottom = rule(shellCss, ".app-shell__bottom");

    expect(bottom).toMatch(/bottom:\s*calc\([^;]*--safe-bottom/);
    expect(bottom).not.toMatch(/(^|\n)\s*top:/);
    expect(bottom).toMatch(/position:\s*absolute/);
  });

  it("grows the Dock upward instead of pushing it down", () => {
    const bottom = rule(shellCss, ".app-shell__bottom");
    const dock = rule(shellCss, ".app-shell__dock");

    expect(bottom).toContain("flex-direction: column-reverse");
    expect(bottom).toMatch(/max-height:\s*calc/);
    expect(dock).toContain("min-height: 0");
  });

  it("anchors the toast stack top right, always below the header", () => {
    const toasts = rule(shellCss, ".app-shell__toasts");

    expect(toasts).toMatch(/top:\s*calc\([\s\S]*--shell-header-block/);
    expect(toasts).toMatch(/right:\s*calc\([^;]*--safe-right/);
    expect(toasts).toContain("align-items: flex-end");
    expect(toasts).not.toMatch(/(^|\n)\s*bottom:/);
  });

  it("bounds the toast stack before it can reach the Dock", () => {
    const toasts = rule(shellCss, ".app-shell__toasts");

    expect(toasts).toMatch(/max-height:\s*max\(/);
    expect(toasts).toContain("--shell-dock-reserve");
    expect(toasts).toContain("overflow-y: auto");
  });

  it("anchors a shell-less toast region to the top as well", () => {
    const region = rule(toastCss, ".toast-region");

    expect(region).toMatch(/top:\s*calc/);
    expect(region).not.toMatch(/(^|\n)\s*bottom:/);
    expect(region).toContain("justify-content: flex-end");
  });

  it("stacks world, Dock, header, toasts and overlays in that order", () => {
    expect(layerDepth(".app-shell__world")).toBe(0);
    expect(layerDepth(".app-shell__bottom")).toBeGreaterThan(
      layerDepth(".app-shell__world"),
    );
    expect(layerDepth(".app-shell__header")).toBeGreaterThan(
      layerDepth(".app-shell__bottom"),
    );
    expect(layerDepth(".app-shell__toasts")).toBeGreaterThan(
      layerDepth(".app-shell__header"),
    );
    expect(layerDepth(".app-shell__overlay")).toBeGreaterThan(
      layerDepth(".app-shell__toasts"),
    );
  });

  it("leaves no authenticated success hero on the world surface", () => {
    expect(worldView).not.toContain("You’re in.");
    expect(worldView).not.toContain("Authenticated as");
  });

  it("never gives the Bond surface ownership of application settings", () => {
    expect(worldView).not.toContain("bond-dock__settings");

    const dockMarkup = worldView.slice(
      worldView.indexOf('className="bond-dock"'),
    );
    expect(dockMarkup).not.toContain("SETTINGS_ROUTE");
  });

  it("keeps the canonical routes and refuses the map a peer tab", () => {
    expect(productApp).toContain("path: IDENTITY_ROUTE");
    expect(productApp).toContain("path: SETTINGS_ROUTE");
    expect(productApp).not.toMatch(/<Link\s/);
    expect(productApp).not.toContain('aria-label="0x1 sections"');
  });
});
