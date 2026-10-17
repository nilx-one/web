// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import {
  ROUTE_SOURCE_ID,
  routeData,
  routeLayers,
  routeSource,
} from "./route-layer";

const route = {
  points: [
    [30.4467, 50.4734],
    [30.48, 50.46],
    [30.5131, 50.4489],
  ] as const,
};

describe("route layer", () => {
  it("draws one line through every point, and nothing for a single point", () => {
    const data = routeData(route) as {
      features: { geometry: { type: string; coordinates: number[][] } }[];
    };
    expect(data.features).toHaveLength(1);
    expect(data.features[0]?.geometry.type).toBe("LineString");
    expect(data.features[0]?.geometry.coordinates).toEqual([
      [30.4467, 50.4734],
      [30.48, 50.46],
      [30.5131, 50.4489],
    ]);
    expect(
      (routeData({ points: [[30.5, 50.4]] }) as { features: unknown[] })
        .features,
    ).toEqual([]);
  });

  it("is a valid dash-dot style", () => {
    const layers = routeLayers();
    const line = layers.find((layer) => layer.id === "route-line") as {
      paint: Record<string, unknown>;
    };
    expect(line.paint["line-dasharray"]).toHaveLength(4);
    const errors = validateStyleMin({
      version: 8,
      sources: { [ROUTE_SOURCE_ID]: routeSource(route) },
      layers,
    } as never);
    expect(errors).toEqual([]);
  });
});
