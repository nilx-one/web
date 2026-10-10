// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_MODEL_IDS } from "@nilx-one/map-contract";
import { Box3, Mesh } from "three";
import { describe, expect, it, vi } from "vitest";
import { createPingModel } from "./ping-model";
import { createAvatarLayer } from "./avatar-layer";

describe("xPing system prop", () => {
  it("has actual bounded 3D geometry and deterministic reduced motion", () => {
    const model = createPingModel();
    model.sample(0, false);
    const bounds = new Box3().setFromObject(model.root);
    expect(bounds.min.y).toBeGreaterThan(1.5);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(1.5);
    const initial = JSON.stringify(model.root.toJSON());
    model.sample(0.5, false);
    model.root.updateMatrixWorld(true);
    expect(JSON.stringify(model.root.toJSON())).toEqual(initial);
    model.sample(0.2, true);
    model.root.updateMatrixWorld(true);
    expect(JSON.stringify(model.root.toJSON())).not.toEqual(initial);
    expect(AVATAR_MODEL_IDS).not.toContain("system-ping");
    model.dispose();
  });
  it("disposes its owned geometry and materials", () => {
    const model = createPingModel();
    const disposals: ReturnType<typeof vi.fn>[] = [];
    model.root.traverse((node) => {
      if (node instanceof Mesh) {
        const spy = vi.fn();
        node.geometry.addEventListener("dispose", spy);
        disposals.push(spy);
      }
    });
    model.dispose();
    expect(disposals.length).toBeGreaterThan(8);
    for (const spy of disposals) expect(spy).toHaveBeenCalledOnce();
  });
  it("uses a separate prop capability with no avatar asset request", () => {
    const loadAsset = vi.fn();
    const layer = createAvatarLayer({ loadAsset });
    layer.upsertDrone({
      id: "system:xPing",
      lngLat: [30.5, 50.4],
      bearingDeg: 180,
      phase: 0,
      reducedMotion: true,
    });
    expect(layer.hasInstances()).toBe(true);
    expect(loadAsset).not.toHaveBeenCalled();
    layer.remove("system:xPing");
    expect(layer.hasInstances()).toBe(false);
    layer.dispose();
  });
});
