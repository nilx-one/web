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
  HemisphereLight,
  Matrix4,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  MOTHERLAND_MONUMENT_FACING_DEG,
  MOTHERLAND_MONUMENT_LOCATION,
} from "./monument-site";
import { terrainElevationMeters } from "./terrain-elevation";

export { MOTHERLAND_MONUMENT_LOCATION } from "./monument-site";

export const MONUMENT_LAYER_ID = "nilx-one-motherland-monument";
export const MONUMENT_ASSET_VERSION = "0.2.0";
export const MONUMENT_ASSET_URL = `/monuments/${MONUMENT_ASSET_VERSION}/motherland.glb`;

type AssetLoader = (signal: AbortSignal) => Promise<Object3D>;

/**
 * Stands the model up in the layer's Mercator-aligned frame (x east, y
 * south, z up), `scale` scene units to the metre. The asset is glTF Y-up,
 * authored in metres facing -Z with her right hand on +X. Mercator's y runs
 * south, so turning Y up alone would leave her mirrored, the sword in her
 * left hand: flipping Z first keeps her right-handed, and the bearing then
 * turns her to face the Dnipro.
 */
export function orientMonument(root: Object3D, scale: number): void {
  root.scale.set(scale, scale, -scale);
  root.rotation.set(
    Math.PI / 2,
    0,
    (MOTHERLAND_MONUMENT_FACING_DEG * Math.PI) / 180,
    "ZXY",
  );
}

function defaultLoadAsset(signal: AbortSignal): Promise<Object3D> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("Monument load aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    loader.load(
      MONUMENT_ASSET_URL,
      (gltf) => {
        signal.removeEventListener("abort", onAbort);
        resolve(gltf.scene);
      },
      undefined,
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export interface MonumentCustomLayer extends CustomLayerInterface {
  isSettled(): boolean;
  /** True while the model is loaded and standing in this mount. */
  hasModel(): boolean;
  setDimension(dimension: MapDimension): void;
  dispose(): void;
}

export interface MonumentLayerOptions {
  readonly loadAsset?: AssetLoader;
  /**
   * Called each time the model is loaded into a mount: the moment the
   * basemap's own statue can give way to it, and not before, so a model
   * that never arrives never leaves an empty pylon behind.
   */
  readonly onModel?: () => void;
}

/**
 * The futuristic Motherland study, drawn the same way a body is: its own
 * Three scene, composited into MapLibre's WebGL context via a custom layer,
 * placed each frame from a local metre-scale origin so its geometry survives
 * float32 next to a Mercator coordinate near 0.5. Unlike a body, it never
 * moves and carries no skeleton — one glTF load, one static root.
 *
 * It draws only in `volumetric` presentation: `flat` shows the world as
 * footprints, and a hundred-metre chrome giant standing over footprints
 * reads as a bug, not a monument.
 */
export function createMonumentLayer(
  options: MonumentLayerOptions = {},
): MonumentCustomLayer {
  const loadAsset = options.loadAsset ?? defaultLoadAsset;
  const scene = new Scene();
  const ambient = new HemisphereLight(0xffffff, 0x6e665e, 2);
  ambient.position.set(0, 0, 1);
  const sunlight = new DirectionalLight(0xfff1df, 2.2);
  sunlight.position.set(-1, -1, 2);
  scene.add(ambient, sunlight);
  const camera = new PerspectiveCamera();
  // Same folded-origin trick the avatar layer uses: the monument's own
  // vertices are authored in metres, so the origin — not the geometry — is
  // what carries the huge Mercator-scale numbers.
  let origin = { x: 0, y: 0, z: 0, metres: 1 };
  const originMatrix = new Matrix4();
  let map: MapLibreMap | undefined;
  let renderer: WebGLRenderer | undefined;
  let root: Object3D | undefined;
  let dimension: MapDimension = "flat";
  // Scoped to one onAdd↔onRemove span, not the layer's whole life: a style
  // swap removes and re-adds every custom layer, and the monument has to
  // survive that the way the avatar layer's instances do. Only `dispose()`
  // — a hard, permanent teardown nothing here currently calls on a style
  // swap — closes the door for good.
  let loadController: AbortController | undefined;
  let disposed = false;
  let settled = false;

  function place(): void {
    if (root === undefined) return;
    const elevation = terrainElevationMeters(map, [
      MOTHERLAND_MONUMENT_LOCATION.lng,
      MOTHERLAND_MONUMENT_LOCATION.lat,
    ]);
    const coordinate = MercatorCoordinate.fromLngLat(
      MOTHERLAND_MONUMENT_LOCATION,
      elevation,
    );
    const metres = coordinate.meterInMercatorCoordinateUnits();
    root.position.set(
      (coordinate.x - origin.x) / origin.metres,
      (coordinate.y - origin.y) / origin.metres,
      (coordinate.z - origin.z) / origin.metres,
    );
    orientMonument(root, metres / origin.metres);
    root.visible = dimension === "volumetric";
    root.updateMatrixWorld(true);
  }

  function anchorAt(mounted: MapLibreMap): void {
    const center = MercatorCoordinate.fromLngLat(mounted.getCenter(), 0);
    origin = {
      x: center.x,
      y: center.y,
      z: center.z,
      metres: center.meterInMercatorCoordinateUnits(),
    };
    place();
  }

  async function hydrate(signal: AbortSignal): Promise<void> {
    try {
      const asset = await loadAsset(signal);
      // Either the whole layer was torn down, or just this mount was — a
      // slow load resolving after `onRemove` must not hand a scene whose
      // renderer is already disposed a new root to retain.
      if (disposed || signal.aborted) return;
      root = asset;
      scene.add(root);
      if (map !== undefined) anchorAt(map);
      options.onModel?.();
      map?.triggerRepaint();
    } catch {
      // Fail closed: a missing monument asset renders nothing, same as a
      // missing study — it never blocks or breaks the map underneath it.
    } finally {
      if (!disposed && !signal.aborted) {
        settled = true;
        map?.triggerRepaint();
      }
    }
  }

  const layer: MonumentCustomLayer = {
    id: MONUMENT_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    isSettled: () => settled,

    hasModel: () => root !== undefined,

    onAdd(mountedMap, gl) {
      settled = false;
      map = mountedMap;
      renderer = new WebGLRenderer({
        canvas: mountedMap.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      loadController = new AbortController();
      void hydrate(loadController.signal);
    },

    render(_gl: WebGL2RenderingContext, frame: CustomRenderMethodInput) {
      if (renderer === undefined || root === undefined || !root.visible) {
        return;
      }
      if (map !== undefined) anchorAt(map);
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
      // Cancels this mount's in-flight load, if any, so a late resolution
      // never adds a root to a scene whose renderer just got disposed.
      settled = false;
      loadController?.abort();
      loadController = undefined;
      root?.removeFromParent();
      root = undefined;
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },

    setDimension(next) {
      dimension = next;
      place();
      map?.triggerRepaint();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      loadController?.abort();
      loadController = undefined;
      root?.removeFromParent();
      root = undefined;
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };

  return layer;
}
