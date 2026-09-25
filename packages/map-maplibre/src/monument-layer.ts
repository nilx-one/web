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

export const MONUMENT_LAYER_ID = "nilx-one-motherland-monument";
export const MONUMENT_ASSET_VERSION = "0.1.0";
export const MONUMENT_ASSET_URL = `/monuments/${MONUMENT_ASSET_VERSION}/motherland.glb`;

/**
 * Kyiv's Motherland Monument — the one fixed, always-there landmark this
 * layer draws. Not a `MapLandmark` the archive publishes: a single
 * hand-placed study, real-world sited, that stands regardless of what the
 * basemap's own POI layer carries.
 */
export const MOTHERLAND_MONUMENT_LOCATION: {
  readonly lng: number;
  readonly lat: number;
} = { lng: 30.5636, lat: 50.4267 };

type AssetLoader = (signal: AbortSignal) => Promise<Object3D>;

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
  setDimension(dimension: MapDimension): void;
  dispose(): void;
}

export interface MonumentLayerOptions {
  readonly loadAsset?: AssetLoader;
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

  function place(): void {
    if (root === undefined) return;
    const coordinate = MercatorCoordinate.fromLngLat(
      MOTHERLAND_MONUMENT_LOCATION,
      0,
    );
    const metres = coordinate.meterInMercatorCoordinateUnits();
    root.position.set(
      (coordinate.x - origin.x) / origin.metres,
      (coordinate.y - origin.y) / origin.metres,
      (coordinate.z - origin.z) / origin.metres,
    );
    root.scale.setScalar(metres / origin.metres);
    // glTF is Y-up; the model is authored Z-up in metres, so this is the same
    // rotation the avatar layer applies, with no bearing to add on top.
    root.rotation.set(Math.PI / 2, 0, 0, "ZXY");
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
      map?.triggerRepaint();
    } catch {
      // Fail closed: a missing monument asset renders nothing, same as a
      // missing study — it never blocks or breaks the map underneath it.
    }
  }

  const layer: MonumentCustomLayer = {
    id: MONUMENT_LAYER_ID,
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
