// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(
    process.cwd(),
    "packages/product-app/src/features/map/authenticated-map-home-view.css",
  ),
  "utf8",
);

const mapVisualLanguage = readFileSync(
  resolve(process.cwd(), "docs/map-visual-language.md"),
  "utf8",
);

describe("authenticated light spatial world", () => {
  it("keeps the near-white world and cyan focus as presentation tokens", () => {
    expect(css).toContain("--map-substrate: #f7f9fa");
    expect(css).toContain("--map-accent-spatial: #37d7e5");
    expect(css).toContain("--header-accent: var(--map-accent-spatial-strong)");
    expect(css).not.toContain("--map-accent-primary: #8a63ff");
    expect(css).not.toContain("--map-accent-counterpart: #ff735f");
  });

  it("makes world chrome translucent instead of darkening the map", () => {
    expect(css).toContain("--map-glass: rgba(250, 253, 253, 0.74)");
    expect(css).toContain("background: var(--map-glass)");
    expect(css).toContain("backdrop-filter: blur(22px) saturate(1.08)");
    expect(css).not.toMatch(
      /\.authenticated-map-home__map\s*\{[^}]*filter\s*:/s,
    );
    expect(css).not.toMatch(
      /\.authenticated-map-home__map\s*\{[^}]*transform\s*:/s,
    );
  });

  it("keeps dark appearance deliberate without changing the visual hierarchy", () => {
    expect(css).toContain('.authenticated-map-home[data-theme="dark"]');
    expect(css).toContain("--map-substrate: #070c0e");
    expect(css).toContain("--map-accent-spatial: #37d7e5");
  });

  it("documents the same world and the data-backed limits", () => {
    expect(mapVisualLanguage).toContain(
      "Light appearance is the primary visual reference",
    );
    expect(mapVisualLanguage).toContain(
      "Dark appearance is a deliberate mapped variant",
    );
    expect(mapVisualLanguage).toContain(
      "text labels require a same-origin glyph payload",
    );
    expect(mapVisualLanguage).toContain(
      "must not be invented solely to imitate a reference image",
    );
  });
});
