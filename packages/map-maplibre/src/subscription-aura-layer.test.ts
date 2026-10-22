// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";
import {
  Object3D,
  Matrix4,
  type Scene,
  type Mesh,
  type ShaderMaterial,
} from "three";
import type * as Three from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { Map as MapLibreMap, CustomRenderMethodInput } from "maplibre-gl";
import type { AvatarHandle } from "@nilx-one/map-contract";
import { createAvatarLayer } from "./avatar-layer";

const capture = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("three", async (original) => ({
  ...(await original<typeof Three>()),
  WebGLRenderer: class {
    autoClear = false;
    resetState() {}
    render = capture.render;
    dispose() {}
  },
}));
const handle: AvatarHandle = {
  id: "bond",
  modelId: "sky-study",
  lngLat: [30.5, 50.4],
  bearingDeg: 0,
  clipId: "idle",
  clipPhase: 0,
  scale: 1,
  visible: true,
};
const map = {
  getCanvas: () => document.createElement("canvas"),
  getTerrain: () => undefined,
  queryTerrainElevation: () => undefined,
  getCenter: () => ({ lng: 30.5, lat: 50.4 }),
  triggerRepaint: vi.fn(),
} as unknown as MapLibreMap;
const gl = {} as WebGL2RenderingContext;
const frame = {
  defaultProjectionData: { mainMatrix: new Matrix4().elements },
} as unknown as CustomRenderMethodInput;

describe("subscription aura lifecycle in the map layer", () => {
  it("fades revocation to disposal but clears a reused identity immediately", async () => {
    let clock = 0;
    const layer = createAvatarLayer({
      now: () => clock,
      loadAsset: async () =>
        ({ scene: new Object3D(), animations: [] }) as unknown as GLTF,
    });
    layer.upsert({
      ...handle,
      subscriptionSubject: "owner-a",
      subscriptionAura: "exclusive",
    });
    layer.onAdd!(map, gl);
    await vi.waitFor(() => expect(layer.assetsSettled()).toBe(true));
    clock = 1000;
    layer.render(gl, frame);
    const scene = capture.render.mock.lastCall![0] as Scene;
    const aura = scene.getObjectByName("subscription-aura") as Mesh<
      Three.BufferGeometry,
      ShaderMaterial
    >;
    expect(aura.material.uniforms.uIntensity!.value).toBe(1);
    layer.upsert({ ...handle, subscriptionSubject: "owner-a" });
    clock = 1350;
    layer.render(gl, frame);
    expect(aura.material.uniforms.uIntensity!.value).toBeCloseTo(0.5);
    clock = 1800;
    layer.render(gl, frame);
    expect(scene.getObjectByName("subscription-aura")).toBeUndefined();
    layer.upsert({
      ...handle,
      subscriptionSubject: "owner-a",
      subscriptionAura: "special",
    });
    layer.upsert({ ...handle, subscriptionSubject: "owner-b" });
    expect(scene.getObjectByName("subscription-aura")).toBeUndefined();
    layer.dispose();
  });
  it("updates tier without duplicating meshes, preserves style remount, clears revocation and disposes", async () => {
    const layer = createAvatarLayer({
      loadAsset: async () =>
        ({ scene: new Object3D(), animations: [] }) as unknown as GLTF,
    });
    layer.upsert({ ...handle, subscriptionAura: "exclusive" });
    layer.onAdd!(map, gl);
    await vi.waitFor(() => expect(layer.assetsSettled()).toBe(true));
    layer.render(gl, frame);
    const scene = capture.render.mock.lastCall![0] as Scene;
    const aura = scene.getObjectByName("subscription-aura") as Mesh<
      Three.BufferGeometry,
      ShaderMaterial
    >;
    expect(aura).toBeDefined();
    const dispose = vi.spyOn(aura.material, "dispose");
    layer.upsert({
      ...handle,
      subscriptionAura: "special",
      reducedMotion: true,
    });
    expect(scene.getObjectByName("subscription-aura")).toBe(aura);
    expect(aura.material.uniforms.uIntensity!.value).toBe(0.46);
    expect(aura.material.uniforms.uTime!.value).toBe(0);
    layer.onRemove!(map, gl);
    layer.onAdd!(map, gl);
    expect(scene.getObjectByName("subscription-aura")).toBe(aura);
    layer.upsert({ ...handle, reducedMotion: true });
    expect(scene.getObjectByName("subscription-aura")).toBeUndefined();
    expect(dispose).toHaveBeenCalledTimes(1);
    layer.upsert({ ...handle, subscriptionAura: "exclusive" });
    const fresh = scene.getObjectByName("subscription-aura") as typeof aura;
    const geometry = vi.spyOn(fresh.geometry, "dispose");
    layer.remove(handle.id);
    layer.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
  });
  it("does not resurrect a revoked tier when the model finishes loading", async () => {
    let complete!: (asset: GLTF) => void;
    const layer = createAvatarLayer({
      loadAsset: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    });
    layer.upsert({ ...handle, subscriptionAura: "exclusive" });
    layer.onAdd!(map, gl);
    layer.upsert(handle);
    complete({ scene: new Object3D(), animations: [] } as unknown as GLTF);
    await vi.waitFor(() => expect(layer.assetsSettled()).toBe(true));
    layer.render(gl, frame);
    expect(
      (capture.render.mock.lastCall![0] as Scene).getObjectByName(
        "subscription-aura",
      ),
    ).toBeUndefined();
    layer.dispose();
  });
});
