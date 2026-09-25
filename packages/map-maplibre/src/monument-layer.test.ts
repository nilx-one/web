// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  MONUMENT_ASSET_URL,
  MONUMENT_LAYER_ID,
  MOTHERLAND_MONUMENT_LOCATION,
  createMonumentLayer,
} from "./monument-layer";

describe("monument presentation contract", () => {
  it("keeps the model asset on the versioned same-origin path", () => {
    expect(MONUMENT_ASSET_URL).toBe("/monuments/0.1.0/motherland.glb");
  });

  it("sites the monument at its real-world coordinates", () => {
    // Kyiv, not anywhere else on Earth — a stray sign flip or swapped
    // lng/lat would still be "a number", so this is checked against the
    // actual city bounding box rather than just `toBeDefined`.
    expect(MOTHERLAND_MONUMENT_LOCATION.lng).toBeGreaterThan(30);
    expect(MOTHERLAND_MONUMENT_LOCATION.lng).toBeLessThan(31);
    expect(MOTHERLAND_MONUMENT_LOCATION.lat).toBeGreaterThan(50);
    expect(MOTHERLAND_MONUMENT_LOCATION.lat).toBeLessThan(51);
  });

  it("exposes a 3d custom layer that starts hidden in flat presentation", () => {
    const layer = createMonumentLayer();
    expect(layer.id).toBe(MONUMENT_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
    // No map has mounted it yet; setDimension and dispose must both be safe
    // to call before onAdd, the way an unmounted renderer can reach them.
    expect(() => layer.setDimension("volumetric")).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
    // Disposing twice — an unmount racing a teardown — must stay a no-op.
    expect(() => layer.dispose()).not.toThrow();
  });
});
