// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_ASSET_VERSIONS, FLIGHT_LOOT_COLORS } from "@nilx-one/map-contract";
import type {
  AvatarClipId,
  AvatarHandle,
  AvatarLayerContract,
  AvatarModelId,
  FlightLootRarity,
  MapFlightLoot,
  SystemDroneHandle,
  SystemDroneKind,
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
  AdditiveBlending,
  AnimationMixer,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
} from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

import { createPingModel } from "./ping-model";
import { createFlightLootModel } from "./flight-loot-model";
import {
  createAmbientDroneKit,
  type AmbientDroneKit,
} from "./ambient-drone-model";
import {
  BACKPACK_ASSET_URL,
  createBackpackSource,
  disposeBackpack,
  mountBackpack,
} from "./backpack-model";

import {
  loadedTerrainElevationMeters,
  terrainBodyPitchRadians,
} from "./terrain-elevation";

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
const GLTF_NODE_NAME = "gltfNodeName";

type SceneHandle = Omit<AvatarHandle, "modelId"> & {
  readonly modelId: AvatarModelId | "system-ping";
  readonly reducedMotion?: boolean;
  /** Metres above the drawn ground, for a prop that flies. */
  readonly liftMeters?: number;
  /** A system drone's engine wear, 0 to 1. */
  readonly wear?: number;
  /** Actual flight speed for existing airflow effect. */
  readonly speedMps?: number;
  /** Which system drone this is; omitted, xPing. */
  readonly droneKind?: SystemDroneKind;
  readonly lootAura?: FlightLootRarity;
  /** Banking and leaning in the model's own frame, in degrees. */
  readonly rollDeg?: number;
  readonly pitchDeg?: number;
};
/** What the layer needs of a drone model, xPing's or an ambient one. */
interface DroneModel {
  readonly root: Object3D;
  sample(
    phase: number,
    moving: boolean,
    wear?: number,
    speedMps?: number,
    aura?: FlightLootRarity,
  ): void;
  dispose(): void;
}

interface AvatarInstance {
  backpack?: Object3D;
  backpackLoading?: boolean;
  handle: SceneHandle;
  drone?: DroneModel;
  root?: Object3D;
  mixer?: AnimationMixer;
  clips?: ReadonlyMap<string, AnimationClip>;
  actionClip?: AvatarClipId;
  terrainAnchor?:
    | {
        readonly key: string;
        readonly elevationMeters: number;
      }
    | undefined;
  loadGeneration: number;
}

/**
 * How a body is turned in Mercator's Z-up frame. glTF is Y-up, so it is
 * rotated upright, then turned to its bearing. The studies face glTF +Z,
 * which lands on Mercator north; Mercator's y grows southward, so a positive
 * turn about its Z axis is clockwise on the ground, as a compass reads.
 * Leaning and banking happen in the model's own frame, facing +Z with +Y up
 * and its +X on the east when it faces north: a positive pitch lowers the
 * nose, a positive roll lowers that +X side, the right one on the ground.
 */
export function bodyOrientation(
  bearingDeg: number,
  terrainPitchRadians = 0,
  pitchDeg = 0,
  rollDeg = 0,
): Quaternion {
  const orientation = new Quaternion().setFromEuler(
    new Euler(
      Math.PI / 2 + terrainPitchRadians,
      0,
      (bearingDeg * Math.PI) / 180,
      "ZXY",
    ),
  );
  if (pitchDeg === 0 && rollDeg === 0) return orientation;
  return orientation.multiply(
    new Quaternion().setFromEuler(
      new Euler((pitchDeg * Math.PI) / 180, 0, (-rollDeg * Math.PI) / 180),
    ),
  );
}

export interface AvatarCustomLayer
  extends CustomLayerInterface, AvatarLayerContract {
  upsertDrone(handle: SystemDroneHandle): boolean;
  setFlightLoot(handles: readonly MapFlightLoot[]): void;
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
 * Keep each glTF node's own name on the object it became.
 *
 * Three's loader strips the characters it reserves for animation bindings —
 * `:` and `/` among them — from object names, so `wear:top/tee-black` arrives
 * as `weartoptee-black` and could never be matched against the names the
 * application uses. The asset's name is recorded once per loaded asset and,
 * living in `userData`, survives every clone of it.
 */
export function rememberGltfNodeNames(gltf: GLTF): void {
  const nodes = (gltf.parser?.json?.nodes ?? []) as readonly {
    name?: string;
  }[];
  for (const [object, reference] of gltf.parser?.associations ?? []) {
    if (!(object instanceof Object3D) || reference.nodes === undefined)
      continue;
    const name = nodes[reference.nodes]?.name;
    if (typeof name === "string") object.userData[GLTF_NODE_NAME] = name;
  }
}

function nodeName(object: Object3D): string {
  const recorded: unknown = object.userData[GLTF_NODE_NAME];
  return typeof recorded === "string" ? recorded : object.name;
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
    const name = nodeName(object);
    if (!name.includes(APPLICATION_NODE_MARK)) return;
    object.visible = visibleNodes.includes(name);
  });
}

export function createAvatarLayer(
  options: AvatarLayerOptions = {},
): AvatarCustomLayer {
  const loadAsset = options.loadAsset ?? defaultLoadAsset;
  const now = options.now ?? (() => globalThis.performance.now());
  const requestMount = options.requestMount ?? (() => undefined);
  const instances = new Map<string, AvatarInstance>();
  const flightLoot = new Map<string, {
    handle: MapFlightLoot;
    model: ReturnType<typeof createFlightLootModel>;
  }>();
  const assetCache = new Map<AvatarModelId, Promise<GLTF>>();
  const backpackSource = createBackpackSource(
    () => new GLTFLoader().loadAsync(BACKPACK_ASSET_URL),
    now,
  );
  const abortController = new AbortController();
  const scene = new Scene();
  const laserGeometry = new CylinderGeometry(0.055, 0.055, 1, 8);
  const laserBeams = Array.from({ length: 2 }, () => {
    const material = new MeshBasicMaterial({
      color: FLIGHT_LOOT_COLORS.rare,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const beam = new Mesh(laserGeometry, material);
    beam.visible = false;
    scene.add(beam);
    return beam;
  });
  // Custom layers have their own Three scene: MapLibre's map lighting does
  // not illuminate the GLB's PBR materials. Mercator uses Z as vertical.
  const ambient = new HemisphereLight(0xffffff, 0x6e665e, 2);
  ambient.position.set(0, 0, 1);
  const sunlight = new DirectionalLight(0xfff1df, 2.2);
  sunlight.position.set(-1, -1, 2);
  scene.add(ambient, sunlight);
  const camera = new PerspectiveCamera();
  // The scene is drawn in metres around a local origin rather than in raw
  // Mercator units. A 1.8 m body is about 4e-8 of the world wide, below what a
  // float32 can resolve next to a coordinate near 0.5, so on the GPU its
  // vertices would snap to a coarse grid and the body would shatter into
  // shards. The origin is folded into the projection here, in float64, so what
  // reaches the shader is only metres from the camera's own ground.
  let origin = { x: 0, y: 0, z: 0, metres: 1 };
  const originMatrix = new Matrix4();
  let map: MapLibreMap | undefined;
  let renderer: WebGLRenderer | undefined;
  let cameraState: MapCamera | undefined;
  let disposed = false;
  let generation = 0;
  let lastFrame = now();
  // Made on the first ambient drone and shared by all of them after.
  let ambientKit: AmbientDroneKit | undefined;

  function buildDrone(kind: SystemDroneKind | undefined): DroneModel {
    if (kind === undefined || kind === "xping") return createPingModel();
    ambientKit ??= createAmbientDroneKit();
    return ambientKit.build(kind);
  }

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
    syncBackpack(instance);
  }

  function syncBackpack(instance: AvatarInstance): void {
    if (instance.backpack !== undefined) {
      instance.backpack.visible = instance.handle.backpack === true;
      return;
    }
    if (
      !instance.handle.backpack ||
      instance.root === undefined ||
      instance.backpackLoading
    )
      return;
    const request = backpackSource.request();
    if (request === undefined) return;
    const root = instance.root;
    const localGeneration = instance.loadGeneration;
    instance.backpackLoading = true;
    void request
      .then((asset) => {
        if (
          disposed ||
          localGeneration !== instance.loadGeneration ||
          instance.root !== root
        )
          return;
        const mounted = mountBackpack(root, asset.scene);
        if (mounted !== undefined) {
          instance.backpack = mounted;
          mounted.visible = instance.handle.backpack === true;
          map?.triggerRepaint();
        }
      })
      .catch(() => {
        // A carry asset must never prevent the body or map from rendering;
        // the source forgets a failed fetch, so a later sync tries again.
        if (localGeneration === instance.loadGeneration)
          instance.backpackLoading = false;
      });
  }

  function releaseBackpack(instance: AvatarInstance): void {
    if (instance.backpack !== undefined) disposeBackpack(instance.backpack);
    delete instance.backpack;
    delete instance.backpackLoading;
  }

  function terrainAltitude(instance: AvatarInstance): number {
    const { lngLat } = instance.handle;
    const terrainSource = map?.getTerrain()?.source;
    if (map === undefined || terrainSource === undefined) {
      instance.terrainAnchor = undefined;
      return 0;
    }

    const key = `${terrainSource}:${lngLat[0]}:${lngLat[1]}`;
    if (instance.terrainAnchor?.key === key) {
      return instance.terrainAnchor.elevationMeters;
    }

    const elevation = loadedTerrainElevationMeters(map, lngLat);
    if (elevation === undefined) {
      instance.terrainAnchor = undefined;
      return 0;
    }

    instance.terrainAnchor = { key, elevationMeters: elevation };
    return elevation;
  }

  function place(instance: AvatarInstance): void {
    const root = instance.root;
    if (root === undefined) return;
    const { lngLat, bearingDeg, scale } = instance.handle;
    // With volumetric terrain, an unspecified altitude means "stand on the
    // ground MapLibre actually draws". An explicit altitude remains absolute
    // metres above sea level and is never silently offset by terrain.
    const altitude =
      instance.handle.altitudeMeters ??
      terrainAltitude(instance) + (instance.handle.liftMeters ?? 0);
    const coordinate = MercatorCoordinate.fromLngLat(
      { lng: lngLat[0], lat: lngLat[1] },
      altitude,
    );
    const metres = coordinate.meterInMercatorCoordinateUnits();
    root.position.set(
      (coordinate.x - origin.x) / origin.metres,
      (coordinate.y - origin.y) / origin.metres,
      (coordinate.z - origin.z) / origin.metres,
    );
    root.scale.setScalar((metres / origin.metres) * scale);
    const terrainPitch =
      instance.handle.altitudeMeters === undefined &&
      instance.handle.modelId !== "system-ping"
        ? terrainBodyPitchRadians(map, lngLat, bearingDeg)
        : 0;
    root.quaternion.copy(
      bodyOrientation(
        bearingDeg,
        terrainPitch,
        instance.handle.pitchDeg,
        instance.handle.rollDeg,
      ),
    );
    root.visible = instance.handle.visible;
    root.updateMatrixWorld(true);
  }

  function placeFlightLoot(
    entry: { handle: MapFlightLoot; model: ReturnType<typeof createFlightLootModel> },
  ): void {
    if (map === undefined) return;
    const { lngLat, heightMeters } = entry.handle;
    const altitude = (loadedTerrainElevationMeters(map, lngLat) ?? 0) + heightMeters;
    const coordinate = MercatorCoordinate.fromLngLat(
      { lng: lngLat[0], lat: lngLat[1] },
      altitude,
    );
    const metres = coordinate.meterInMercatorCoordinateUnits();
    entry.model.root.position.set(
      (coordinate.x - origin.x) / origin.metres,
      (coordinate.y - origin.y) / origin.metres,
      (coordinate.z - origin.z) / origin.metres,
    );
    entry.model.root.scale.setScalar(metres / origin.metres);
    entry.model.root.quaternion.copy(bodyOrientation(0));
    entry.model.root.updateMatrixWorld(true);
  }

  const beamDirection = new Vector3();
  const beamOrigin = new Vector3(0, 1, 0);
  function updateLootLasers(): void {
    const source = instances.get("flyover:xPing")?.root;
    const targets = [...flightLoot.values()]
      .filter(({ handle }) => handle.laserTarget && handle.intakeProgress === undefined)
      .slice(0, 2);
    for (const [index, beam] of laserBeams.entries()) {
      const target = targets[index];
      beam.visible = source !== undefined && target !== undefined;
      if (!source || !target) continue;
      beamDirection.subVectors(target.model.root.position, source.position);
      const distance = beamDirection.length();
      if (distance <= 0.01) {
        beam.visible = false;
        continue;
      }
      beam.position.copy(source.position).add(target.model.root.position).multiplyScalar(0.5);
      beam.quaternion.setFromUnitVectors(beamOrigin, beamDirection.multiplyScalar(1 / distance));
      beam.scale.set(1, distance, 1);
      (beam.material as MeshBasicMaterial).color.setHex(FLIGHT_LOOT_COLORS[target.handle.rarity]);
    }
  }

  function anchorAt(mounted: MapLibreMap): void {
    const center = MercatorCoordinate.fromLngLat(mounted.getCenter(), 0);
    origin = {
      x: center.x,
      y: center.y,
      z: center.z,
      metres: center.meterInMercatorCoordinateUnits(),
    };
    for (const instance of instances.values()) place(instance);
    for (const entry of flightLoot.values()) {
      placeFlightLoot(entry);
      const pull = entry.handle.intakeProgress;
      const target = instances.get("flyover:xPing")?.root;
      if (pull !== undefined && target !== undefined) {
        const amount = Math.max(0, Math.min(1, pull));
        entry.model.root.position.lerp(target.position, amount * amount * (3 - 2 * amount));
        entry.model.root.scale.multiplyScalar(1 - 0.85 * amount);
      }
    }
    updateLootLasers();
  }

  async function hydrate(instance: AvatarInstance): Promise<void> {
    const localGeneration = instance.loadGeneration;
    if (instance.handle.modelId === "system-ping") {
      instance.drone?.dispose();
      const drone = buildDrone(instance.handle.droneKind);
      instance.drone = drone;
      instance.root = drone.root;
      drone.sample(
        instance.handle.clipPhase,
        !instance.handle.reducedMotion,
        instance.handle.wear,
        instance.handle.speedMps,
        instance.handle.lootAura,
      );
      scene.add(drone.root);
      place(instance);
      map?.triggerRepaint();
      return;
    }
    try {
      const asset = await requestAsset(instance.handle.modelId);
      if (disposed || localGeneration !== instance.loadGeneration) return;
      rememberGltfNodeNames(asset);
      const root = cloneSkeleton(asset.scene);
      const mixer = new AnimationMixer(root);
      instance.root?.removeFromParent();
      releaseBackpack(instance);
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

  function upsertBody(handle: SceneHandle): void {
    if (disposed) return;
    const existing = instances.get(handle.id);
    if (
      existing !== undefined &&
      existing.handle.modelId === handle.modelId &&
      existing.handle.droneKind === handle.droneKind
    ) {
      existing.handle = handle;
      existing.drone?.sample(
        handle.clipPhase,
        !handle.reducedMotion,
        handle.wear,
        handle.speedMps,
        handle.lootAura,
      );
      place(existing);
      applyVisibility(existing);
      applyClip(existing);
      map?.triggerRepaint();
      return;
    }
    existing?.drone?.dispose();
    if (existing !== undefined) {
      existing.loadGeneration = ++generation;
      releaseBackpack(existing);
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
  }

  const layer: AvatarCustomLayer = {
    id: AVATAR_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(mountedMap, gl) {
      map = mountedMap;
      for (const instance of instances.values())
        instance.terrainAnchor = undefined;
      renderer = new WebGLRenderer({
        canvas: mountedMap.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      lastFrame = now();
      // A style swap takes the layer off the map and puts it back; the bodies
      // already standing in this scene stay as they are. Only a body that has
      // never been drawn is loaded and cloned: everything after that first
      // draw is a flag on `visible`, never a fresh clone of the same study.
      for (const instance of instances.values()) {
        if (instance.root === undefined) void hydrate(instance);
      }
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
      if ([...instances.values()].some((instance) => instance.handle.visible)) {
        map?.triggerRepaint();
      }
    },

    onRemove() {
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
      for (const instance of instances.values())
        instance.terrainAnchor = undefined;
    },

    upsert: upsertBody,

    upsertDrone(handle) {
      upsertBody({
        id: handle.id,
        modelId: "system-ping",
        lngLat: handle.lngLat,
        bearingDeg: handle.bearingDeg,
        clipId: "idle",
        clipPhase: handle.phase,
        scale: handle.scale ?? 1,
        ...(handle.heightMeters === undefined
          ? {}
          : { liftMeters: handle.heightMeters }),
        ...(handle.rollDeg === undefined ? {} : { rollDeg: handle.rollDeg }),
        ...(handle.pitchDeg === undefined ? {} : { pitchDeg: handle.pitchDeg }),
        ...(handle.wear === undefined ? {} : { wear: handle.wear }),
        ...(handle.speedMps === undefined ? {} : { speedMps: handle.speedMps }),
        ...(handle.lootAura === undefined ? {} : { lootAura: handle.lootAura }),
        ...(handle.kind === undefined ? {} : { droneKind: handle.kind }),
        visible: true,
        reducedMotion: handle.reducedMotion,
      });
      return (
        renderer !== undefined && instances.get(handle.id)?.root !== undefined
      );
    },

    setFlightLoot(handles) {
      const desired = new Set(handles.map((handle) => handle.id));
      for (const [id, entry] of flightLoot) {
        if (desired.has(id)) continue;
        entry.model.dispose();
        flightLoot.delete(id);
      }
      for (const handle of handles) {
        let entry = flightLoot.get(handle.id);
        if (
          entry !== undefined &&
          (entry.handle.kind !== handle.kind || entry.handle.rarity !== handle.rarity)
        ) {
          entry.model.dispose();
          flightLoot.delete(handle.id);
          entry = undefined;
        }
        if (entry === undefined) {
          const model = createFlightLootModel(handle.kind, handle.rarity);
          scene.add(model.root);
          entry = { handle, model };
          flightLoot.set(handle.id, entry);
        }
        entry.handle = handle;
        entry.model.setNear(handle.near);
        placeFlightLoot(entry);
      }
      if (handles.length > 0) requestMount();
      map?.triggerRepaint();
    },

    remove(id) {
      const instance = instances.get(id);
      if (instance === undefined) return;
      instance.loadGeneration = ++generation;
      instance.mixer?.stopAllAction();
      instance.drone?.dispose();
      releaseBackpack(instance);
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
      return instances.size > 0 || flightLoot.size > 0;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      abortController.abort();
      for (const instance of instances.values()) {
        instance.mixer?.stopAllAction();
        instance.drone?.dispose();
        releaseBackpack(instance);
        instance.root?.removeFromParent();
      }
      instances.clear();
      laserGeometry.dispose();
      for (const beam of laserBeams) {
        (beam.material as MeshBasicMaterial).dispose();
        beam.removeFromParent();
      }
      for (const entry of flightLoot.values()) entry.model.dispose();
      flightLoot.clear();
      ambientKit?.dispose();
      ambientKit = undefined;
      assetCache.clear();
      backpackSource.release();
      renderer?.dispose();
      renderer = undefined;
      map = undefined;
    },
  };

  return layer;
}
