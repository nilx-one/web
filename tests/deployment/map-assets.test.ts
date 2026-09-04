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
  readonly paint?: Record<string, unknown>;
}

interface MapStyleContract {
  readonly version: number;
  readonly metadata?: Record<string, unknown>;
  readonly sources: Record<string, MapStyleSource>;
  readonly layers: readonly MapStyleLayer[];
}

const APPEARANCE_FILES = {
  light: "deploy/web/map/0.1.0/style.json",
  dark: "deploy/web/map/0.1.0/style-dark.json",
} as const;

// Layer names published by the OpenStreetMap-derived Protomaps basemap the
// regional archive is extracted from. A style must not reference anything else.
const SOURCE_LAYERS = [
  "earth",
  "landcover",
  "landuse",
  "water",
  "roads",
  "buildings",
  "boundaries",
  "places",
  "pois",
];

function readStyleText(appearance: keyof typeof APPEARANCE_FILES): string {
  return readFileSync(resolve(APPEARANCE_FILES[appearance]), "utf8");
}

function readStyle(
  appearance: keyof typeof APPEARANCE_FILES,
): MapStyleContract {
  return JSON.parse(readStyleText(appearance)) as MapStyleContract;
}

function structure(style: MapStyleContract): readonly string[] {
  return style.layers.map(
    (layer) => `${layer.id}:${layer.type}:${layer["source-layer"] ?? "-"}`,
  );
}

describe("map deployment assets", () => {
  it.each(["light", "dark"] as const)(
    "publishes the versioned same-origin regional basemap contract (%s)",
    (appearance) => {
      const style = readStyle(appearance);

      expect(style.version).toBe(8);
      expect(style.metadata?.["nilx-one:contract-version"]).toBe("0.1.0");
      expect(style.metadata?.["nilx-one:basemap-url"]).toBe(
        "/map/0.1.0/basemap.pmtiles",
      );
      expect(style.metadata?.["nilx-one:basemap-state"]).toBe(
        "regional-server-published",
      );
      expect(style.metadata?.["nilx-one:coverage"]).toBe("kyiv-bootstrap");
      expect(style.metadata?.["nilx-one:appearance"]).toBe(appearance);
      expect(style.sources.basemap).toEqual({
        type: "vector",
        url: "pmtiles:///map/0.1.0/basemap.pmtiles",
        attribution: "© OpenStreetMap contributors",
      });
    },
  );

  it.each(["light", "dark"] as const)(
    "reads only basemap layers the published archive provides (%s)",
    (appearance) => {
      const style = readStyle(appearance);

      for (const layer of style.layers) {
        if (layer.type === "background") {
          expect(layer["source-layer"]).toBeUndefined();
          continue;
        }

        expect(layer.source).toBe("basemap");
        expect(SOURCE_LAYERS).toContain(layer["source-layer"]);
      }
    },
  );

  it("orders geography, roads, urban depth, and minor detail by visual priority", () => {
    const layerIds = readStyle("light").layers.map((layer) => layer.id);

    expect(layerIds).toEqual([
      "background",
      "earth",
      "landcover",
      "parks",
      "landuse-urban",
      "water",
      "water-accent",
      "rivers",
      "buildings-flat",
      "roads-rail",
      "roads-secondary",
      "roads-casing",
      "roads-primary",
      "buildings",
      "boundaries",
      "pois",
    ]);
  });

  it("keeps both appearances structurally identical so appearance is a palette swap", () => {
    expect(structure(readStyle("dark"))).toEqual(structure(readStyle("light")));
  });

  it("locks the near-white spatial palette without protocol semantics", () => {
    const style = readStyle("light");

    expect(style.metadata?.["nilx-one:visual-language"]).toBe("0x1-spatial");
    expect(style.metadata?.["nilx-one:visual-direction"]).toBe(
      "near-white spatial map with restrained cyan accents",
    );
    expect(style.metadata?.["nilx-one:surface-background"]).toBe("#f7f9fa");
    expect(style.metadata?.["nilx-one:surface-land"]).toBe("#f3f6f7");
    expect(style.metadata?.["nilx-one:surface-parks"]).toBe("#edf4f1");
    expect(style.metadata?.["nilx-one:surface-buildings"]).toBe("#e8eef0");
    expect(style.metadata?.["nilx-one:road-primary"]).toBe("#d5e1e4");
    expect(style.metadata?.["nilx-one:road-secondary"]).toBe("#e4ebed");
    expect(style.metadata?.["nilx-one:water-base"]).toBe("#dff7fa");
    expect(style.metadata?.["nilx-one:label-primary"]).toBe("#536166");
    expect(style.metadata?.["nilx-one:label-secondary"]).toBe("#879399");
    expect(style.metadata?.["nilx-one:accent-semantics"]).toBe(
      "presentation-only",
    );
  });

  it("spends the cyan accent on water and never as a global fill", () => {
    for (const appearance of ["light", "dark"] as const) {
      const style = readStyle(appearance);
      const accent = style.metadata?.["nilx-one:accent-primary"];
      expect(accent).toBe("#37d7e5");

      const accented = style.layers.filter((layer) =>
        JSON.stringify(layer.paint).includes(String(accent)),
      );
      expect(accented.map((layer) => layer.id)).toEqual([
        "water-accent",
        "rivers",
      ]);
    }
  });

  it("gives central Kyiv restrained extruded depth at close zoom", () => {
    const buildings = readStyle("light").layers.find(
      (layer) => layer.id === "buildings",
    );

    expect(buildings?.type).toBe("fill-extrusion");
    expect(buildings?.paint?.["fill-extrusion-height"]).toEqual([
      "coalesce",
      ["get", "height"],
      7,
    ]);
  });

  it.each(["light", "dark"] as const)(
    "keeps runtime map data same-origin (%s)",
    (appearance) => {
      const style = readStyleText(appearance);

      expect(style).not.toContain("https://");
      expect(style).not.toContain("http://");
    },
  );
});
