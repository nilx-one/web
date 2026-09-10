// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_ASSET_VERSIONS } from "@nilx-one/map-contract";
import type {
  AvatarClipId,
  AvatarHandle,
  AvatarLayerContract,
  AvatarModelId,
  MapCamera,
} from "@nilx-one/map-contract";
// The ambient sampler is contract-level policy: the application chooses the
// body and the moment, so it must be able to sample without the renderer.
export {
  sampleAmbientAvatar,
  type AmbientAvatarSample,
} from "@nilx-one/map-contract";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
} from "maplibre-gl";
import {
  AnimationMixer,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

export const AVATAR_LAYER_ID = "nilx-one-local-avatars";
export { AVATAR_ASSET_VERSION } from "@nilx-one/map-contract";

export const AVATAR_ASSET_URLS: Readonly<Record<AvatarModelId, string>> = {
  "sky-study": `/avatars/${AVATAR_ASSET_VERSIONS["sky-study"]}/sky-study.glb`,
  "dasha-study": `/avatars/${AVATAR_ASSET_VERSIONS["dasha-study"]}/dasha-study.glb`,
  "kai-study": `/avatars/${AVATAR_ASSET_VERSIONS["kai-study"]}/kai-study.glb`,
  "dasha-v2-study": `/avatars/${AVATAR_ASSET_VERSIONS["dasha-v2-study"]}/dasha-v2-study.glb`,
};

type AssetLoader = (
  modelId: AvatarModelId,
  signal: AbortSignal,
) => Promise<GLTF>;

/**
 * The mark of a node whose visibility the application decides.
 *
 * A namespaced name is a part of a modular character — a body region, a worn
 * item; a bare name is the asset's own, a bone or an armature, and is never
 * touched. The renderer needs no more than that: what the namespaces mean is
 * the application's to know.
 */
const APPLICATION_NODE_MARK = ":";

interface AvatarInstance {
  handle: AvatarHandle;
  root?: Object3D;
  mixer?: AnimationMixer;
  clips?: ReadonlyMap<string, AnimationClip>;
  actionClip?: AvatarClipId;
  loadGeneration: number;
}

export interface AvatarCustomLayer
  extends CustomLayerInterface, AvatarLayerContract {
  hasInstances(): boolean;
  dispose(): void;
}

export interface AvatarLayerOptions {
  readonly loadAsset?: AssetLoader;
  readonly now?: () => number;
  readonly requestMount?: () => void;
}

function defaultLoadAsset(
  modelId: AvatarModelId,
  signal: AbortSignal,
): Promise<GLTF> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException("Avatar load aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    loader.load(
      AVATAR_ASSET_URLS[modelId],
      (gltf) => {
        signal.removeEventListener("abort", onAbort);
        resolve(gltf);
      },
      undefined,
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Show what this body is wearing, and only that.
 *
 * A modular study carries every wearable it publishes in the one asset, so
 * changing clothes is this and nothing more: no second fetch, no swapped
 * skeleton, no reload of the identity underneath. The renderer is told which
 * names to draw and never works out what an outfit is — with no names given,
 * the asset is drawn exactly as it was authored.
 */
export function applyAvatarNodeVisibility(
  root: Object3D,
  visibleNodes: readonly string[] | undefined,
): void {
  if (visibleNodes === undefined || visibleNodes.length === 0) return;
  root.traverse((object) => {
    if (!object.name.includes(APPLICATION_NODE_MARK)) return;
    object.visible = visibleNodes.includes(object.name);
  });
}

export function createAvatarLayer(
  options: AvatarLayerOptions = {},
): AvatarCustomLayer {
  const loadAsset = options.loadAsset ?? defaultLoadAsset;
  const now = options.now ?? (() => globalThis.performance.now());
  const requestMount = options.requestMount ?? (() => undefined);
  const instances = new Map<string, AvatarInstance>();
  const assetCache = new Map<AvatarModelId, Promise<GLTF>>();
  const abortController = new AbortController();
  const scene = new Scene();
  // Custom layers have their own Three scene: MapLibre's map lighting does
  // not illuminate the GLB's PBR materials. Mercator uses Z as vertical.
  const ambient = new HemisphereLight(0xffffff, 0x6e665e, 2);
  ambient.position.set(0, 0, 1);
  const sunlight = new DirectionalLight(0xfff1df, 2.2);
  sunlight.position.set(-1, -1, 2);
  scene.add(ambient, sunlight);
  const camera = new PerspectiveCamera();
  let map: MapLibreMap | undefined;
  let renderer: WebGLRenderer | undefined;
  let cameraState: MapCamera | undefined;
  let disposed = false;
  let generation = 0;
  let lastFrame = now();

  function requestAsset(modelId: AvatarModelId): Promise<GLTF> {
    const cached = assetCache.get(modelId);
    if (cached !== undefined) return cached;
    const pending = loadAsset(modelId, abortController.signal).catch(
      (error) => {
        assetCache.delete(modelId);
        throw error;
      },
    );
    assetCache.set(modelId, pending);
    return pending;
  }

  function applyClip(instance: AvatarInstance): void {
    if (instance.mixer === undefined || instance.clips === undefined) return;
    const next = instance.clips.get(instance.handle.clipId);
    if (next === undefined) return;
    if (instance.actionClip !== instance.handle.clipId) {
      instance.mixer.stopAllAction();
      const action = instance.mixer.clipAction(next);
      action.reset().play();
      instance.actionClip = instance.handle.clipId;
    }
    const duration = Math.max(next.duration, Number.EPSILON);
    instance.mixer.setTime(
      duration * Math.min(0.999999, Math.max(0, instance.handle.clipPhase)),
    );
  }

  function applyVisibility(instance: AvatarInstance): void {
    if (instance.root === undefined) return;
    applyAvatarNodeVisibility(instance.root, instance.handle.visibleNodes);
  }

  function place(instance: AvatarInstance): void {
    const root = instance.root;
    if (root === undefined) return;
    const { lngLat, altitudeMeters = 0, bearingDeg, scale } = instance.handle;
    const coordinate = MercatorCoordinate.fromLngLat(
      { lng: lngLat[0], lat: lngLat[1] },
      altitudeMeters,
    );
    const metres = coordinate.meterInMercatorCoordinateUnits();
    root.position.set(coordinate.x, coordinate.y, coordinate.z);
    root.scale.setScalar(metres * scale);
    // glTF is Y-up. Rotate it into Mercator's Z-up frame, then apply bearing.
    root.rotation.set(Math.PI / 2, 0, (-bearingDeg * Math.PI) / 180, "ZXY");
    root.visible = instance.handle.visible;
    root.updateMatrixWorld(true);
  }

  async function hydrate(instance: AvatarInstance): Promise<void> {
    const localGeneration = instance.loadGeneration;
    try {
      const asset = await requestAsset(instance.handle.modelId);
      if (disposed || localGeneration !== instance.loadGeneration) return;
      const root = cloneSkeleton(asset.scene);
      const mixer = new AnimationMixer(root);
      instance.root?.removeFromParent();
      instance.root = root;
      instance.mixer = mixer;
      instance.clips = new Map(
        asset.animations.map((clip) => [clip.name, clip]),
      );
      scene.add(root);
      place(instance);
      applyVisibility(instance);
      applyClip(instance);
      map?.triggerRepaint();
    } catch {
      // Fail closed: a missing study asset renders nothing and does not affect the map.
    }
  }

  const layer: AvatarCustomLayer = {
    id: AVATAR_LAYER_ID,
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
      lastFrame = now();
      for (const instance of instances.values()) void hydrate(instance);
    },

    render(_gl: WebGL2RenderingContext, frame: CustomRenderMethodInput) {
      if (renderer === undefined) return;
      const current = now();
      const deltaSeconds = Math.min(
        0.1,
        Math.max(0, current - lastFrame) / 1000,
      );
      lastFrame = current;
      for (const instance of instances.values()) {
        if (instance.handle.visible) instance.mixer?.update(deltaSeconds);
      }
      camera.projectionMatrix.fromArray(frame.defaultProjectionData.mainMatrix);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
      if ([...instances.values()].some((instance) => instance.handle.visible)) {
        map?.triggerRepaint();
      }
    },

    onRemove() {
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },

    upsert(handle) {
      if (disposed) return;
      const existing = instances.get(handle.id);
      if (
        existing !== undefined &&
        existing.handle.modelId === handle.modelId
      ) {
        existing.handle = handle;
        place(existing);
        applyVisibility(existing);
        applyClip(existing);
        map?.triggerRepaint();
        return;
      }
      existing?.root?.removeFromParent();
      existing?.mixer?.stopAllAction();
      const instance: AvatarInstance = {
        handle,
        loadGeneration: ++generation,
      };
      instances.set(handle.id, instance);
      requestMount();
      if (map !== undefined) void hydrate(instance);
    },

    remove(id) {
      const instance = instances.get(id);
      if (instance === undefined) return;
      instance.loadGeneration = ++generation;
      instance.mixer?.stopAllAction();
      instance.root?.removeFromParent();
      instances.delete(id);
      map?.triggerRepaint();
    },

    setCamera(next) {
      // Stored only as local presentation input. Projection remains MapLibre-owned.
      cameraState = next;
      void cameraState;
    },

    hasInstances() {
      return instances.size > 0;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abortController.abort();
      for (const instance of instances.values()) {
        instance.mixer?.stopAllAction();
        instance.root?.removeFromParent();
      }
      instances.clear();
      assetCache.clear();
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };

  return layer;
}
