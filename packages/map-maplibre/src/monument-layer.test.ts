// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import {
  MONUMENT_ASSET_URL,
  MONUMENT_LAYER_ID,
  MOTHERLAND_MONUMENT_LOCATION,
  createMonumentLayer,
  orientMonument,
} from "./monument-layer";
import { MOTHERLAND_MONUMENT_FACING_DEG } from "./monument-site";

describe("monument presentation contract", () => {
  it("keeps the model asset on the versioned same-origin path", () => {
    expect(MONUMENT_ASSET_URL).toBe("/monuments/0.2.0/motherland.glb");
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

  it("lets a style swap remove and re-add the layer without onRemove killing it for good", () => {
    // MapLibre's setStyle removes and re-adds every custom layer; onRemove
    // has to leave the layer able to load again, unlike dispose(), which is
    // the one call that closes the door for good.
    const layer = createMonumentLayer();
    // The implementation never reads either argument, so any placeholder
    // satisfies the interface's declared signature.
    const detachedRemove = () => layer.onRemove?.({} as never, {} as never);
    expect(detachedRemove).not.toThrow();
    expect(detachedRemove).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });
});

describe("monument orientation", () => {
  // Where a glTF direction of the asset ends up in the layer's frame:
  // x east, y south (Mercator), z up.
  function placed(direction: [number, number, number]): Vector3 {
    const root = new Object3D();
    orientMonument(root, 1);
    root.updateMatrixWorld(true);
    return new Vector3(...direction).transformDirection(root.matrixWorld);
  }

  it("stands the figure upright, not lying on the ground", () => {
    const up = placed([0, 1, 0]);
    expect(up.z).toBeCloseTo(1);
  });

  it("faces her north-east, toward the Dnipro", () => {
    const front = placed([0, 0, -1]);
    const bearing = (Math.atan2(front.x, -front.y) * 180) / Math.PI;
    expect(bearing).toBeCloseTo(MOTHERLAND_MONUMENT_FACING_DEG);
    expect(front.z).toBeCloseTo(0);
  });

  it("keeps the sword in her right hand, on her south-east side", () => {
    const right = placed([1, 0, 0]);
    const bearing = (Math.atan2(right.x, -right.y) * 180) / Math.PI;
    expect(bearing).toBeCloseTo(MOTHERLAND_MONUMENT_FACING_DEG + 90);
  });
});
