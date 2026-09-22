// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  OBSERVED_POSITION_CELL_LAYER_ID,
  OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
  OBSERVED_POSITION_CELL_RESOLUTION,
  observedPositionLayers,
  observedPositionSource,
} from "./observed-position";

const POSITION = {
  center: [30.5234, 50.4501] as const,
  accuracyMeters: 8,
};

describe("observed local cell", () => {
  it("uses a presentation-only H3 resolution close to 10 m", () => {
    expect(OBSERVED_POSITION_CELL_RESOLUTION).toBe(12);
  });

  it("keeps the local cell and device point in one presentation source", () => {
    const source = observedPositionSource(POSITION);
    const features = (
      source.data as {
        features: Array<{ geometry: { type: string; coordinates: unknown } }>;
      }
    ).features;

    expect(features).toHaveLength(2);
    expect(features[0]?.geometry.type).toBe("Polygon");
    expect(features[1]?.geometry.type).toBe("Point");
  });

  it("keeps the cell separate from the accuracy and point layers", () => {
    const layers = observedPositionLayers(POSITION);
    const cell = layers.find(
      (layer) => layer.id === OBSERVED_POSITION_CELL_LAYER_ID,
    );
    const outline = layers.find(
      (layer) => layer.id === OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
    );

    expect(cell?.type).toBe("fill");
    expect(outline?.type).toBe("line");
    expect(layers.filter((layer) => layer.type === "circle")).toHaveLength(3);
  });
});
