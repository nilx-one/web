// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapDimension } from "@nilx-one/map-contract";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from "maplibre-gl";
import {
  DirectionalLight,
  Euler,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import bushUrl from "./assets/vegetation/bush.glb?url";
import hedgeUrl from "./assets/vegetation/hedge.glb?url";
import treePineUrl from "./assets/vegetation/tree-pine.glb?url";
import treeRoundUrl from "./assets/vegetation/tree-round.glb?url";
import treeTallUrl from "./assets/vegetation/tree-tall.glb?url";
import { loadedTerrainElevationMeters } from "./terrain-elevation";
import {
  VEGETATION_MODELS,
  type VegetationInstance,
  type VegetationModel,
} from "./vegetation-placement";

export const VEGETATION_LAYER_ID = "nilx-one-vegetation";

export const VEGETATION_ASSET_URLS: Readonly<Record<VegetationModel, string>> =
  {
    "tree-round": treeRoundUrl,
    "tree-tall": treeTallUrl,
    "tree-pine": treePineUrl,
    bush: bushUrl,
    hedge: hedgeUrl,
  };

/** One model's parts: a mesh per material, all drawn with the same matrices. */
export interface VegetationPart {
  readonly geometry: BufferGeometry;
  readonly material: Material;
}

type AssetLoader = (
  model: VegetationModel,
  signal: AbortSignal,
) => Promise<readonly VegetationPart[]>;

async function defaultLoadAsset(
  model: VegetationModel,
  signal: AbortSignal,
): Promise<readonly VegetationPart[]> {
  const gltf = await new GLTFLoader().loadAsync(VEGETATION_ASSET_URLS[model]);
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return partsOf(gltf.scene);
}

/** The meshes of a still model, with their transforms baked in. */
export function partsOf(root: Object3D): readonly VegetationPart[] {
  root.updateMatrixWorld(true);
  const parts: VegetationPart[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) parts.push({ geometry, material });
  });
  return parts;
}

/**
 * Stands a model in the layer's Mercator-aligned frame (x east, y south,
 * z up): glTF is Y-up, so it is turned upright, then about its trunk.
 */
export function vegetationMatrix(
  position: Vector3,
  bearingDeg: number,
  scale: number,
  target = new Matrix4(),
): Matrix4 {
  const turn = new Quaternion().setFromEuler(
    new Euler(Math.PI / 2, 0, (bearingDeg * Math.PI) / 180, "ZXY"),
  );
  return target.compose(position, turn, new Vector3(scale, scale, scale));
}

export interface VegetationCustomLayer extends CustomLayerInterface {
  /** What the view's green areas hold now; an empty list clears them. */
  setInstances(instances: readonly VegetationInstance[]): void;
  setDimension(dimension: MapDimension): void;
  /** How many of each model are drawn, for tests and diagnostics. */
  counts(): Readonly<Record<VegetationModel, number>>;
  dispose(): void;
}

export interface VegetationLayerOptions {
  readonly loadAsset?: AssetLoader;
}

/**
 * Trees and bushes, by the thousand: one instanced mesh per model part, so a
 * whole park is a handful of draw calls. They are placed once per update,
 * around an origin of their own, and that origin is folded into the
 * projection each frame, the way the avatar and monument layers keep their
 * metre-scale geometry exact next to a Mercator coordinate near 0.5.
 *
 * They draw only in `volumetric` presentation, like the monument: `flat`
 * shows the world as footprints.
 */
export function createVegetationLayer(
  options: VegetationLayerOptions = {},
): VegetationCustomLayer {
  const loadAsset = options.loadAsset ?? defaultLoadAsset;
  const scene = new Scene();
  const sky = new HemisphereLight(0xffffff, 0x6e665e, 2);
  sky.position.set(0, 0, 1);
  const sun = new DirectionalLight(0xfff1df, 2.2);
  sun.position.set(-1, -1, 2);
  scene.add(sky, sun);
  const camera = new PerspectiveCamera();
  const originMatrix = new Matrix4();
  let origin = { x: 0, y: 0, z: 0, metres: 1 };
  let map: MapLibreMap | undefined;
  let renderer: WebGLRenderer | undefined;
  let dimension: MapDimension = "flat";
  let disposed = false;
  let wanted: readonly VegetationInstance[] = [];
  const abort = new AbortController();
  const parts = new Map<VegetationModel, readonly VegetationPart[]>();
  const loading = new Set<VegetationModel>();
  const meshes = new Map<VegetationModel, InstancedMesh[]>();
  const counts = Object.fromEntries(
    VEGETATION_MODELS.map((model) => [model, 0]),
  ) as Record<VegetationModel, number>;

  function request(model: VegetationModel): void {
    if (parts.has(model) || loading.has(model) || disposed) return;
    loading.add(model);
    void loadAsset(model, abort.signal)
      .then((loaded) => {
        if (disposed) return;
        parts.set(model, loaded);
        build();
      })
      .catch(() => {
        // A model that does not arrive is a park drawn without it; the next
        // update asks again.
      })
      .finally(() => loading.delete(model));
  }

  function clear(model: VegetationModel): void {
    for (const mesh of meshes.get(model) ?? []) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    meshes.delete(model);
    counts[model] = 0;
  }

  /** Lays every wanted instance around a fresh origin at the view's centre. */
  function build(): void {
    if (map !== undefined) {
      const centre = MercatorCoordinate.fromLngLat(map.getCenter(), 0);
      origin = {
        x: centre.x,
        y: centre.y,
        z: centre.z,
        metres: centre.meterInMercatorCoordinateUnits(),
      };
    }
    const byModel = new Map<VegetationModel, VegetationInstance[]>();
    for (const instance of wanted) {
      const list = byModel.get(instance.model) ?? [];
      list.push(instance);
      byModel.set(instance.model, list);
    }
    const matrix = new Matrix4();
    const position = new Vector3();
    for (const model of VEGETATION_MODELS) {
      clear(model);
      const instances = byModel.get(model) ?? [];
      if (instances.length === 0) continue;
      const loaded = parts.get(model);
      if (loaded === undefined) {
        request(model);
        continue;
      }
      const built = loaded.map(({ geometry, material }) => {
        const mesh = new InstancedMesh(geometry, material, instances.length);
        mesh.frustumCulled = false;
        return mesh;
      });
      instances.forEach((instance, index) => {
        const ground =
          map === undefined
            ? 0
            : (loadedTerrainElevationMeters(map, instance.lngLat) ?? 0);
        const at = MercatorCoordinate.fromLngLat(
          { lng: instance.lngLat[0], lat: instance.lngLat[1] },
          ground,
        );
        position.set(
          (at.x - origin.x) / origin.metres,
          (at.y - origin.y) / origin.metres,
          (at.z - origin.z) / origin.metres,
        );
        vegetationMatrix(position, instance.bearingDeg, instance.scale, matrix);
        for (const mesh of built) mesh.setMatrixAt(index, matrix);
      });
      for (const mesh of built) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = dimension === "volumetric";
        scene.add(mesh);
      }
      meshes.set(model, built);
      counts[model] = instances.length;
    }
    map?.triggerRepaint();
  }

  const layer: VegetationCustomLayer = {
    id: VEGETATION_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mountedMap, gl) {
      map = mountedMap;
      renderer = new WebGLRenderer({
        canvas: mountedMap.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      // A style swap re-adds the layer: what stands is placed again on the
      // ground the new style draws, from models already loaded.
      build();
    },

    render(_gl: WebGL2RenderingContext, frame: CustomRenderMethodInput) {
      if (renderer === undefined || dimension !== "volumetric") return;
      if (wanted.length === 0) return;
      originMatrix
        .makeScale(origin.metres, origin.metres, origin.metres)
        .setPosition(origin.x, origin.y, origin.z);
      camera.projectionMatrix
        .fromArray(frame.defaultProjectionData.mainMatrix)
        .multiply(originMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
    },

    onRemove() {
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },

    setInstances(instances) {
      wanted = instances;
      build();
    },

    setDimension(next) {
      dimension = next;
      for (const list of meshes.values())
        for (const mesh of list) mesh.visible = next === "volumetric";
      map?.triggerRepaint();
    },

    counts: () => ({ ...counts }),

    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const model of VEGETATION_MODELS) clear(model);
      for (const loaded of parts.values())
        for (const { geometry, material } of loaded) {
          geometry.dispose();
          material.dispose();
        }
      parts.clear();
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };

  return layer;
}
