// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";

import {
  VEGETATION_ASSET_URLS,
  VEGETATION_LAYER_ID,
  createVegetationLayer,
  partsOf,
  vegetationMatrix,
  type VegetationPart,
} from "./vegetation-layer";
import {
  VEGETATION_MODELS,
  type VegetationInstance,
  type VegetationModel,
} from "./vegetation-placement";

const part = (): VegetationPart => ({
  geometry: new BoxGeometry(1, 1, 1),
  material: new MeshStandardMaterial(),
});

function tree(id: string, model: VegetationModel): VegetationInstance {
  return { id, model, lngLat: [30.52, 50.45], bearingDeg: 0, scale: 1 };
}

/** Resolves every requested model at once, and counts the requests. */
function instantLoader() {
  const requested: VegetationModel[] = [];
  return {
    requested,
    loadAsset: (model: VegetationModel) => {
      requested.push(model);
      return Promise.resolve([part(), part()]);
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("vegetation layer", () => {
  it("is a 3d custom layer with an asset for every model", () => {
    const layer = createVegetationLayer();
    expect(layer.id).toBe(VEGETATION_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("3d");
    for (const model of VEGETATION_MODELS)
      expect(VEGETATION_ASSET_URLS[model]).toMatch(/\.glb/);
    // Safe before any map mounts it, and twice over.
    expect(() => layer.setDimension("volumetric")).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
    expect(() => layer.dispose()).not.toThrow();
  });

  it("loads each model once and draws every instance of it", async () => {
    const loader = instantLoader();
    const layer = createVegetationLayer({ loadAsset: loader.loadAsset });
    layer.setInstances([
      tree("a", "tree-round"),
      tree("b", "tree-round"),
      tree("c", "bush"),
    ]);
    // Asked for while still loading: no second request.
    layer.setInstances([
      tree("a", "tree-round"),
      tree("b", "tree-round"),
      tree("c", "bush"),
    ]);
    await settle();
    expect(loader.requested.sort()).toEqual(["bush", "tree-round"]);
    expect(layer.counts()).toMatchObject({
      "tree-round": 2,
      bush: 1,
      "tree-pine": 0,
    });
    layer.setInstances([tree("d", "bush")]);
    expect(layer.counts()).toMatchObject({ "tree-round": 0, bush: 1 });
    expect(loader.requested).toHaveLength(2);
    layer.setInstances([]);
    expect(Object.values(layer.counts()).every((n) => n === 0)).toBe(true);
    layer.dispose();
  });

  it("draws nothing for a model whose asset fails, and asks again later", async () => {
    let calls = 0;
    const layer = createVegetationLayer({
      loadAsset: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("offline"))
          : Promise.resolve([part()]);
      },
    });
    layer.setInstances([tree("a", "tree-pine")]);
    await settle();
    expect(layer.counts()["tree-pine"]).toBe(0);
    layer.setInstances([tree("a", "tree-pine")]);
    await settle();
    expect(calls).toBe(2);
    expect(layer.counts()["tree-pine"]).toBe(1);
    layer.dispose();
  });

  it("ignores an asset that arrives after dispose", async () => {
    const loader = instantLoader();
    const layer = createVegetationLayer({ loadAsset: loader.loadAsset });
    layer.setInstances([tree("a", "hedge")]);
    layer.dispose();
    await settle();
    expect(layer.counts().hedge).toBe(0);
  });

  it("bakes each mesh's transform into its part", () => {
    const root = new Group();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), [
      new MeshStandardMaterial(),
      new MeshStandardMaterial(),
    ]);
    mesh.position.set(0, 2, 0);
    root.add(mesh);
    const parts = partsOf(root);
    expect(parts).toHaveLength(2);
    const [first] = parts;
    first?.geometry.computeBoundingBox();
    expect(first?.geometry.boundingBox?.min.y).toBeCloseTo(1.5);
  });

  it("stands a Y-up model upright, z up in the layer's frame", () => {
    const matrix = vegetationMatrix(new Vector3(10, 20, 0), 0, 2);
    const top = new Vector3(0, 1, 0).applyMatrix4(matrix);
    expect(top.x).toBeCloseTo(10);
    expect(top.y).toBeCloseTo(20);
    expect(top.z).toBeCloseTo(2);
    // A bearing turns it about its own trunk and nowhere else.
    const turned = vegetationMatrix(new Vector3(), 90, 1, new Matrix4());
    const trunk = new Vector3(0, 5, 0).applyMatrix4(turned);
    expect(trunk.x).toBeCloseTo(0);
    expect(trunk.y).toBeCloseTo(0);
    expect(trunk.z).toBeCloseTo(5);
  });
});
