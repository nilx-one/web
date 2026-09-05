// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readStylesheet(relativePath: string): string {
  // Comments explain the rules; they are never part of what a rule declares.
  return readFileSync(resolve(process.cwd(), relativePath), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

const authenticatedMapCss = readStylesheet(
  "packages/product-app/src/features/map/authenticated-map-home-view.css",
);

const authenticatedMapSettingsCss = readStylesheet(
  "packages/product-app/src/features/map/authenticated-map-settings.css",
);

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = authenticatedMapCss.match(
    new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`),
  );

  expect(match, `${selector} rule is required`).not.toBeNull();
  return match?.[1] ?? "";
}

function rulesTargeting(css: string, selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    ...css.matchAll(
      new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`, "g"),
    ),
  ].map((match) => match[1] ?? "");
}

describe("authenticated map renderer surface", () => {
  it("keeps renderer compositing neutral and presentation effects in the shade", () => {
    const rendererSurface = cssRule(".authenticated-map-home__map");
    const shade = cssRule(".authenticated-map-home__shade");

    expect(rendererSurface).not.toMatch(/(^|\n)\s*filter\s*:/);
    expect(rendererSurface).not.toMatch(/(^|\n)\s*transform\s*:/);
    expect(shade).toContain("pointer-events: none");
    expect(shade).toContain("linear-gradient");
  });

  it("never corrects the published map style with an appearance-specific filter", () => {
    const themedSurfaces = [
      ...rulesTargeting(
        authenticatedMapSettingsCss,
        ".authenticated-map-home__map",
      ),
      ...rulesTargeting(authenticatedMapCss, ".authenticated-map-home__map"),
    ];

    for (const rule of themedSurfaces) {
      expect(rule).not.toMatch(/(^|\n)\s*filter\s*:/);
      expect(rule).not.toMatch(/(^|\n)\s*transform\s*:/);
    }
  });
});
