// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface MapStyleSource {
  readonly type?: string;
  readonly url?: string;
  readonly attribution?: string;
}

interface MapStyleLayer {
  readonly id?: string;
  readonly type?: string;
  readonly source?: string;
  readonly "source-layer"?: string;
}

interface MapStyleContract {
  readonly version: number;
  readonly metadata?: Record<string, unknown>;
  readonly sources: Record<string, MapStyleSource>;
  readonly layers: readonly MapStyleLayer[];
}

const stylePath = resolve("deploy/web/map/0.1.0/style.json");

describe("map deployment assets", () => {
  it("publishes the versioned same-origin regional basemap contract", () => {
    const style = JSON.parse(
      readFileSync(stylePath, "utf8"),
    ) as MapStyleContract;

    expect(style.version).toBe(8);
    expect(style.metadata?.["nilx-one:contract-version"]).toBe("0.1.0");
    expect(style.metadata?.["nilx-one:basemap-url"]).toBe(
      "/map/0.1.0/basemap.pmtiles",
    );
    expect(style.metadata?.["nilx-one:basemap-state"]).toBe(
      "regional-server-published",
    );
    expect(style.metadata?.["nilx-one:coverage"]).toBe("kyiv-bootstrap");
    expect(style.sources.basemap).toEqual({
      type: "vector",
      url: "pmtiles:///map/0.1.0/basemap.pmtiles",
      attribution: "© OpenStreetMap contributors",
    });
  });

  it("renders geographic data, roads, close-zoom buildings, and POI presence", () => {
    const style = JSON.parse(
      readFileSync(stylePath, "utf8"),
    ) as MapStyleContract;

    const layerIds = style.layers.map((layer) => layer.id);
    expect(layerIds).toEqual(
      expect.arrayContaining([
        "background",
        "landuse",
        "water",
        "roads-casing",
        "roads",
        "buildings",
        "pois",
      ]),
    );

    expect(style.layers.find((layer) => layer.id === "buildings")?.type).toBe(
      "fill-extrusion",
    );
    expect(
      style.layers.find((layer) => layer.id === "roads")?.["source-layer"],
    ).toBe("roads");
  });

  it("locks the mineral-light presentation palette without protocol semantics", () => {
    const style = JSON.parse(
      readFileSync(stylePath, "utf8"),
    ) as MapStyleContract;

    expect(style.metadata?.["nilx-one:visual-language"]).toBe("mineral-light");
    expect(style.metadata?.["nilx-one:surface-background"]).toBe("#f7f8f6");
    expect(style.metadata?.["nilx-one:surface-raised"]).toBe("#eef0ef");
    expect(style.metadata?.["nilx-one:surface-shadow"]).toBe("#c8cdcc");
    expect(style.metadata?.["nilx-one:geography-graphite"]).toBe("#545b5c");
    expect(style.metadata?.["nilx-one:accent-primary"]).toBe("#00d8f2");
    expect(style.metadata?.["nilx-one:accent-counterpart"]).toBe("#ff7a1a");
    expect(style.metadata?.["nilx-one:accent-semantics"]).toBe(
      "presentation-only",
    );
  });

  it("keeps runtime map data same-origin", () => {
    const style = readFileSync(stylePath, "utf8");

    expect(style).not.toContain("https://");
    expect(style).not.toContain("http://");
  });
});
