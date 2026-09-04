// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const authenticatedMapCss = readFileSync(
  new URL(
    "../../packages/product-app/src/features/map/authenticated-map-home-view.css",
    import.meta.url,
  ),
  "utf8",
);

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = authenticatedMapCss.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`),
  );

  expect(match, `${selector} rule is required`).not.toBeNull();
  return match?.[1] ?? "";
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
});
