// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface MapStyleContract {
  readonly version: number;
  readonly metadata?: Record<string, unknown>;
  readonly sources: Record<string, unknown>;
  readonly layers: readonly unknown[];
}

const stylePath = resolve("deploy/web/map/0.1.0/style.json");

describe("map deployment assets", () => {
  it("publishes the versioned same-origin map style contract", () => {
    const style = JSON.parse(
      readFileSync(stylePath, "utf8"),
    ) as MapStyleContract;

    expect(style.version).toBe(8);
    expect(style.metadata?.["nilx-one:contract-version"]).toBe("0.1.0");
    expect(style.metadata?.["nilx-one:basemap-url"]).toBe(
      "/map/0.1.0/basemap.pmtiles",
    );
    expect(style.metadata?.["nilx-one:basemap-state"]).toBe("not-published");
    expect(style.sources).toEqual({});
    expect(style.layers.length).toBeGreaterThan(0);
  });

  it("keeps the versioned map boundary same-origin", () => {
    const style = readFileSync(stylePath, "utf8");

    expect(style).not.toContain("https://");
    expect(style).not.toContain("http://");
  });
});
