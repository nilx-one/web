// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";
import { Object3D } from "three";
import type * as Three from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { describe, expect, it, vi } from "vitest";
import { createMonumentLayer } from "./monument-layer";
import { createAvatarLayer } from "./avatar-layer";

vi.mock("three", async (original) => {
  const three = await original<typeof Three>();
  return {
    ...three,
    WebGLRenderer: class {
      autoClear = false;
      dispose() {}
    },
  };
});

function map() {
  return {
    getCanvas: () => document.createElement("canvas"),
    getCenter: () => ({ lng: 30.5636, lat: 50.4267 }),
    queryTerrainElevation: () => 0,
    triggerRepaint: vi.fn(),
  } as unknown as MapLibreMap;
}
const gl = {} as WebGL2RenderingContext;

describe("startup model settlement", () => {
  it("preloads both studies and shares their decoded assets before the layer mounts", async () => {
    const asset = { scene: new Object3D(), animations: [] } as unknown as GLTF;
    const loadAsset = vi.fn(async () => asset);
    const layer = createAvatarLayer({ loadAsset });
    await layer.preload(["sky-study", "kai-study", "sky-study"]);
    expect(loadAsset).toHaveBeenCalledTimes(2);
    layer.upsert({
      id: "driver",
      modelId: "sky-study",
      lngLat: [30.5636, 50.4267],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: true,
    });
    expect(loadAsset).toHaveBeenCalledTimes(2);
    layer.dispose();
  });

  it("starts decoding an upserted body before MapLibre adds the custom layer", () => {
    const loadAsset = vi.fn(async () =>
      ({ scene: new Object3D(), animations: [] }) as unknown as GLTF,
    );
    const layer = createAvatarLayer({ loadAsset });
    layer.upsert({
      id: "driver",
      modelId: "sky-study",
      lngLat: [30.5636, 50.4267],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: true,
    });
    expect(loadAsset).toHaveBeenCalledOnce();
    layer.dispose();
  });

  it("waits for a delayed monument and invalidates its state on style removal", async () => {
    let complete!: (asset: Object3D) => void;
    const layer = createMonumentLayer({
      loadAsset: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    const mounted = map();
    layer.onAdd!(mounted, gl);
    expect(layer.isSettled()).toBe(false);
    complete(new Object3D());
    await Promise.resolve();
    expect(layer.isSettled()).toBe(true);
    layer.onRemove!(mounted, gl);
    expect(layer.isSettled()).toBe(false);
    layer.onAdd!(mounted, gl);
    const stale = complete;
    layer.onRemove!(mounted, gl);
    stale(new Object3D());
    await Promise.resolve();
    expect(layer.isSettled()).toBe(false);
    layer.dispose();
  });
  it("settles the existing optional-monument fallback after a rejected GLB", async () => {
    const layer = createMonumentLayer({
      loadAsset: () => Promise.reject(new Error("offline")),
    });
    layer.onAdd!(map(), gl);
    await Promise.resolve();
    expect(layer.isSettled()).toBe(true);
    layer.dispose();
  });
  it.each([false, true])(
    "waits for a requested body model (failed=%s)",
    async (failed) => {
      let complete!: (asset: GLTF) => void;
      let fail!: (error: Error) => void;
      const layer = createAvatarLayer({
        loadAsset: () =>
          new Promise((resolve, reject) => {
            complete = resolve;
            fail = reject;
          }),
      });
      layer.upsert({
        id: "driver",
        modelId: "sky-study",
        lngLat: [30.5636, 50.4267],
        bearingDeg: 0,
        clipId: "idle",
        clipPhase: 0,
        scale: 1,
        visible: true,
      });
      layer.onAdd!(map(), gl);
      expect(layer.assetsSettled()).toBe(false);
      if (failed) fail(new Error("offline"));
      else
        complete({ scene: new Object3D(), animations: [] } as unknown as GLTF);
      await vi.waitFor(() => expect(layer.assetsSettled()).toBe(true));
      layer.dispose();
    },
  );
});
