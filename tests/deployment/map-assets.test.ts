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
  readonly minzoom?: number;
  readonly maxzoom?: number;
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

const OPACITY_PROPERTY: Readonly<Record<string, string>> = {
  background: "background-opacity",
  fill: "fill-opacity",
  line: "line-opacity",
  "fill-extrusion": "fill-extrusion-opacity",
  circle: "circle-opacity",
};

// Schema validation proves a style is well formed, not that it paints. These
// evaluate the published zoom ramps so a layer cannot go silently invisible.
function interpolateOpacity(stops: readonly unknown[], zoom: number): number {
  const points: { zoom: number; value: number }[] = [];
  for (let index = 0; index < stops.length; index += 2) {
    const stopZoom = stops[index];
    const stopValue = stops[index + 1];
    if (typeof stopZoom !== "number" || typeof stopValue !== "number") {
      throw new Error("opacity stops must be numeric");
    }
    points.push({ zoom: stopZoom, value: stopValue });
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("an interpolation needs at least one stop");
  }
  if (zoom <= first.zoom) return first.value;
  if (zoom >= last.zoom) return last.value;

  for (let index = 0; index < points.length - 1; index += 1) {
    const low = points[index];
    const high = points[index + 1];
    if (low === undefined || high === undefined) continue;
    if (zoom >= low.zoom && zoom <= high.zoom) {
      const span = high.zoom - low.zoom;
      const progress = span === 0 ? 0 : (zoom - low.zoom) / span;
      return low.value + (high.value - low.value) * progress;
    }
  }

  return last.value;
}

function evaluateOpacity(value: unknown, zoom: number): number {
  if (value === undefined) return 1;
  if (typeof value === "number") return value;
  if (!Array.isArray(value)) {
    throw new Error(`unsupported opacity value: ${JSON.stringify(value)}`);
  }

  const [operator, interpolation] = value;
  if (operator === "interpolate") {
    expect(interpolation).toEqual(["linear"]);
    return interpolateOpacity(value.slice(3), zoom);
  }
  if (operator === "match") {
    // Data driven per feature: the layer paints wherever any branch is opaque.
    const outputs = value
      .slice(2)
      .filter((entry): entry is number => typeof entry === "number");
    return Math.max(...outputs);
  }

  throw new Error(`unsupported opacity expression: ${String(operator)}`);
}

function paintsAt(layer: MapStyleLayer, zoom: number): boolean {
  if (zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? 24)) {
    return false;
  }

  const property = OPACITY_PROPERTY[layer.type ?? ""];
  if (property === undefined) {
    throw new Error(`unknown layer type: ${String(layer.type)}`);
  }

  return evaluateOpacity(layer.paint?.[property], zoom) > 0;
}

function layersPaintingAt(
  style: MapStyleContract,
  zoom: number,
): readonly string[] {
  return style.layers
    .filter((layer) => paintsAt(layer, zoom))
    .map((layer) => String(layer.id));
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

  it.each(["light", "dark"] as const)(
    "leaves no published layer permanently invisible (%s)",
    (appearance) => {
      const style = readStyle(appearance);
      const zooms = Array.from({ length: 49 }, (_, step) => step * 0.5);

      const neverPainted = style.layers
        .filter((layer) => !zooms.some((zoom) => paintsAt(layer, zoom)))
        .map((layer) => layer.id);

      expect(neverPainted).toEqual([]);
    },
  );

  it.each(["light", "dark"] as const)(
    "makes Kyiv readable at the bootstrap camera zoom (%s)",
    (appearance) => {
      const painted = layersPaintingAt(readStyle(appearance), 10);

      // Geography, the Dnipro and its accent, and the major road frame.
      expect(painted).toEqual(
        expect.arrayContaining([
          "background",
          "earth",
          "parks",
          "landuse-urban",
          "water",
          "water-accent",
          "rivers",
          "roads-primary",
        ]),
      );

      // Close-zoom detail stays out of the first paint.
      expect(painted).not.toContain("buildings");
      expect(painted).not.toContain("buildings-flat");
      expect(painted).not.toContain("pois");
    },
  );

  it("raises urban depth only as the camera closes in", () => {
    const style = readStyle("light");
    const extrusion = style.layers.find((layer) => layer.id === "buildings");

    expect(extrusion).toBeDefined();
    expect(paintsAt(extrusion as MapStyleLayer, 14)).toBe(false);
    expect(paintsAt(extrusion as MapStyleLayer, 16)).toBe(true);
    expect(layersPaintingAt(style, 13)).toContain("buildings-flat");
  });

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
    expect(readStyle("dark").metadata?.["nilx-one:visual-direction"]).toBe(
      "near-black spatial map with restrained cyan accents",
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
