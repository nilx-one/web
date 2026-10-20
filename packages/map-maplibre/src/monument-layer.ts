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
  BackSide,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type WebGLRenderTarget,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  MOTHERLAND_MONUMENT_FACING_DEG,
  MOTHERLAND_MONUMENT_LOCATION,
} from "./monument-site";
import { terrainElevationMeters } from "./terrain-elevation";

export { MOTHERLAND_MONUMENT_LOCATION } from "./monument-site";

export const MONUMENT_LAYER_ID = "nilx-one-motherland-monument";
export const MONUMENT_ASSET_VERSION = "0.3.0";
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
  scene.add(...monumentLights());
  // The sky the chrome reflects, built on the first frame it is drawn in:
  // MapLibre restores its own GL state after a custom layer renders, not
  // after it is added.
  let sky: WebGLRenderTarget | undefined;
  const camera = new PerspectiveCamera();
  // Same folded-origin trick the avatar layer uses: the monument's own
  // vertices are authored in metres, so the origin — not the geometry — is
  // what carries the huge Mercator-scale numbers.
  let origin = { x: 0, y: 0, z: 0, metres: 1 };
  const originMatrix = new Matrix4();
  const viewProjection = new Matrix4();
  const eye = new Vector3();
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
      viewProjection
        .fromArray(frame.defaultProjectionData.mainMatrix)
        .multiply(originMatrix);
      // Reflections are worked out from where the camera really is, so the
      // chrome shows the sky above it and the city below, as the eye would.
      // MapLibre hands over projection and view as one matrix: the camera
      // goes back into the view half, and the projection keeps the rest.
      cameraCentre(viewProjection, eye);
      // Three rebuilds a camera's world matrix from its position on render.
      camera.position.copy(eye);
      camera.updateMatrixWorld(true);
      camera.projectionMatrix.copy(viewProjection).multiply(camera.matrixWorld);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState();
      if (sky === undefined) {
        sky = skyEnvironment(renderer);
        scene.environment = sky.texture;
        renderer.resetState();
      }
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
      releaseSky();
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
      releaseSky();
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };

  function releaseSky(): void {
    sky?.dispose();
    sky = undefined;
    scene.environment = null;
  }

  return layer;
}

/**
 * The sky of the reference render, as the chrome reflects it: haze-white at
 * the horizon, steel blue overhead, the city's blue shadow below, and the
 * glare of a high sun over her right shoulder. Z is up, as in the layer.
 */
export const MONUMENT_SKY = {
  zenith: "#5f8db0",
  horizon: "#e3f1f7",
  ground: "#36556c",
  sun: "#ffffff",
  /** How much brighter than white the sun's glare is, for the highlights. */
  sunGain: 4,
} as const;

/** Bearings the lights come from, relative to the way she faces. */
const KEY_LIGHT_TURN_DEG = 45;
const RIM_LIGHT_TURN_DEG = 210;

/**
 * Cold daylight, as in the reference: a pale sky and the blue city below,
 * a white key light from in front of her right shoulder, and a cyan rim
 * from behind that outlines her against the sky.
 */
export function monumentLights(): Object3D[] {
  const ambient = new HemisphereLight(0xdff2ff, 0x4a6a82, 1.2);
  ambient.position.set(0, 0, 1);
  const key = new DirectionalLight(0xf4f9ff, 2.4);
  key.position.copy(fromBearing(KEY_LIGHT_TURN_DEG, 1.2));
  const rim = new DirectionalLight(0x8fe8ff, 1.2);
  rim.position.copy(fromBearing(RIM_LIGHT_TURN_DEG, 0.5));
  return [ambient, key, rim];
}

/**
 * A direction in the layer's frame (x east, y south, z up), `turnDeg`
 * clockwise from the way she faces, `rise` up for every one across.
 */
function fromBearing(turnDeg: number, rise: number): Vector3 {
  const bearing = ((MOTHERLAND_MONUMENT_FACING_DEG + turnDeg) * Math.PI) / 180;
  return new Vector3(Math.sin(bearing), -Math.cos(bearing), rise);
}

/**
 * Where the camera stands, given its combined projection and view: the one
 * point that projects to nothing, x, y and w all zero in clip space.
 */
export function cameraCentre(viewProjection: Matrix4, into: Vector3): Vector3 {
  const e = viewProjection.elements;
  // Rows 0, 1 and 3 of the column-major matrix, split into A·p = -d.
  const a = new Matrix3().set(
    e[0]!,
    e[4]!,
    e[8]!,
    e[1]!,
    e[5]!,
    e[9]!,
    e[3]!,
    e[7]!,
    e[11]!,
  );
  const d = new Vector3(e[12]!, e[13]!, e[15]!);
  return into.copy(d.negate().applyMatrix3(a.invert()));
}

function skyEnvironment(renderer: WebGLRenderer): WebGLRenderTarget {
  const geometry = new SphereGeometry(1, 64, 32);
  const position = geometry.getAttribute("position");
  const zenith = new Color(MONUMENT_SKY.zenith);
  const horizon = new Color(MONUMENT_SKY.horizon);
  const ground = new Color(MONUMENT_SKY.ground);
  const sunColor = new Color(MONUMENT_SKY.sun);
  const sun = fromBearing(KEY_LIGHT_TURN_DEG, 1.2).normalize();
  const colors: number[] = [];
  const at = new Vector3();
  const color = new Color();
  for (let i = 0; i < position.count; i++) {
    at.fromBufferAttribute(position, i).normalize();
    if (at.z >= 0) {
      color.copy(horizon).lerp(zenith, Math.pow(at.z, 0.6));
    } else {
      color.copy(horizon).lerp(ground, Math.min(1, -at.z * 3));
    }
    const glare = Math.pow(Math.max(0, at.dot(sun)), 64);
    color
      .lerp(sunColor, Math.min(1, glare))
      .multiplyScalar(1 + glare * (MONUMENT_SKY.sunGain - 1));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({
    vertexColors: true,
    side: BackSide,
  });
  const sky = new Scene();
  sky.add(new Mesh(geometry, material));
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(sky, 0, 0.1, 10);
  pmrem.dispose();
  geometry.dispose();
  material.dispose();
  return target;
}
