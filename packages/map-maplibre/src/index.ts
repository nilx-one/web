// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { waitForScene } from "./scene-ready";

import {
  DEFAULT_MAP_APPEARANCE,
  DEFAULT_MAP_DIMENSION,
  type AmbientAnimalHandle,
  type AmbientAnimalLayerContract,
  type AvatarHandle,
  type SystemDroneHandle,
  type SystemDroneLayerContract,
  type AvatarLayerContract,
  type MapAppearance,
  type MapCamera,
  type MapCameraChange,
  type MapCameraOptions,
  type MapZoomPivot,
  type MapDimension,
  MAP_BODY_HANDOVER_ZOOM,
  avatarAssetUrl,
  MAP_BODY_HEIGHT_METERS,
  mapMetersPerPixel,
  type MapBodyActivation,
  type MapBounds,
  type MapFogField,
  type MapFogMark,
  type MapGround,
  type MapGroundTap,
  type MapLandmark,
  mapDistanceMeters,
  type MapObstacle,
  type MapRoad,
  type MapObservedPosition,
  type MapObservedPositionLabel,
  type MapOrb,
  type MapFlightLoot,
  type MapRoute,
  type MapPinnedLandmark,
  type MapPointSelection,
  type MapRenderer,
  type MapRendererStatus,
  type MapScreenPoint,
} from "@nilx-one/map-contract";
import { bodyAtPoint, type DrawnBody } from "./body-hit-test";
import {
  GPUInitializationError,
  Map as MapLibreMap,
  Marker,
  addProtocol,
  getWorkerUrl,
  setWorkerUrl,
  type DataDrivenPropertyValueSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type MapOptions,
  type SourceSpecification,
} from "maplibre-gl";
// MapLibre resolves its worker from its own module URL. An application build
// inlines the library into an application chunk, so that URL names a file the
// deployment never publishes: the worker never starts, every source stalls
// behind it, and the map dies on the load timeout instead of on a cause. The
// application bundler emits the worker as its own asset here and the renderer
// binds that published URL before the first map is created.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";

import {
  joinAreas,
  type AreaLabel,
  type AreaPart,
  type AreaSources,
} from "./landmark-areas";
import {
  areaLabelOf,
  areaPartOf,
  createLandmarkTileCache,
  LANDUSE_SOURCE_LAYER,
  landmarkFromPoint,
  mergeAreaSources,
  pmtilesLandmarkTiles,
  POI_SOURCE_LAYER,
  WATER_SOURCE_LAYER,
  type FetchLandmarkTile,
} from "./landmark-tiles";
import {
  createRoadTileCache,
  pmtilesRoadTiles,
  ROAD_SOURCE_LAYER,
  type FetchRoadTile,
} from "./road-tiles";

import type { AvatarCustomLayer } from "./avatar-layer";
import {
  BRIDGE_DECK_LAYER_ID,
  BRIDGE_PALETTES,
  BRIDGE_PIER_LAYER_ID,
  BRIDGE_STRUCTURE_MIN_ZOOM,
  BRIDGE_STRUCTURE_SOURCE_ID,
  bridgeStructureLayers,
  bridgeStructures,
  type BridgeStructures,
} from "./bridge-structures";
import type { MonumentCustomLayer } from "./monument-layer";
import type { VegetationCustomLayer } from "./vegetation-layer";
import {
  GREEN_CHARACTER,
  VEGETATION_MIN_ZOOM,
  plantVegetation,
  type AreaPolygon,
  type GreenArea,
  type VegetationInstance,
} from "./vegetation-placement";
import {
  carriesMotherlandCutout,
  carriesMotherlandTerraces,
  MOTHERLAND_PEDESTAL_HEIGHT_METERS,
  MOTHERLAND_TERRACE_COLORS,
  motherlandPedestalRing,
  onlyMotherlandTerraces,
  withoutMotherland,
  withoutMotherlandTerraces,
} from "./monument-site";
import {
  FOG_MARKS_FILL_LAYER_ID,
  FOG_MARKS_OUTLINE_LAYER_ID,
  FOG_MARKS_SOURCE_ID,
  fogMarksData,
  fogMarksLayers,
  fogMarksSource,
  fogPulseLevel,
} from "./fog-marks";
import { ORB_COLLECT_MS, orbFlightFrame, type FlightBead } from "./orb-flight";
import {
  ORB_GLOW_FRAME_MS,
  ORBS_AURA_LAYER_ID,
  ORBS_CORE_LAYER_ID,
  ORBS_GLOW_LAYER_ID,
  ORBS_GOAL_LAYER_ID,
  ORBS_SOURCE_ID,
  type OrbDrawOptions,
  orbColor,
  orbCoreColor,
  orbSeed,
  orbShineSize,
  orbsData,
  orbsFalling,
  orbsGlowing,
  orbsLayers,
  orbsSource,
} from "./orb-layer";
import {
  ROUTE_CASING_LAYER_ID,
  ROUTE_LINE_LAYER_ID,
  ROUTE_SOURCE_ID,
  routeData,
  routeLayers,
  routeSource,
} from "./route-layer";
import {
  PINNED_LANDMARKS_GLOW_LAYER_ID,
  PINNED_LANDMARKS_POINT_LAYER_ID,
  PINNED_LANDMARKS_SOURCE_ID,
  applyPinnedLandmarkLabel,
  createPinnedLandmarkLabelElement,
  pinnedLandmarksData,
  pinnedLandmarksLayers,
  pinnedLandmarksSource,
  layoutPinnedLabels,
  setPinnedLandmarkCardOffset,
  setPinnedLandmarkLabelShown,
} from "./pinned-landmarks";

import {
  applyObservedPositionLabel,
  createObservedPositionLabelElement,
  LABEL_BODY_HEIGHT,
  LABEL_BODY_WIDTH,
  labelBodyCanvas,
  prefersReducedMotion,
  setLabelBody,
  setPartShown,
} from "./observed-position-label";
import {
  OBSERVED_POSITION_ACCURACY_LAYER_ID,
  OBSERVED_POSITION_CELL_LAYER_ID,
  OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
  OBSERVED_POSITION_EDGE_LAYER_ID,
  OBSERVED_POSITION_POINT_LAYER_ID,
  OBSERVED_POSITION_SOURCE_ID,
  accuracyRadiusExpression,
  observedPositionLayers,
  observedPositionSource,
} from "./observed-position";

export {
  OBSERVED_POSITION_ACCURACY_LAYER_ID,
  OBSERVED_POSITION_CELL_LAYER_ID,
  OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
  OBSERVED_POSITION_EDGE_LAYER_ID,
  OBSERVED_POSITION_POINT_LAYER_ID,
  OBSERVED_POSITION_SOURCE_ID,
  accuracyRadiusExpression,
  clampAccuracyMeters,
} from "./observed-position";
export {
  FOG_MARKS_FILL_LAYER_ID,
  FOG_MARKS_OUTLINE_LAYER_ID,
  FOG_MARKS_SOURCE_ID,
} from "./fog-marks";
export {
  ORBS_AURA_LAYER_ID,
  ORBS_CORE_LAYER_ID,
  ORBS_GLOW_LAYER_ID,
  ORBS_GOAL_LAYER_ID,
  ORBS_SOURCE_ID,
} from "./orb-layer";
export {
  PINNED_LANDMARKS_GLOW_LAYER_ID,
  PINNED_LANDMARKS_POINT_LAYER_ID,
  PINNED_LANDMARKS_SOURCE_ID,
  PINNED_LANDMARK_LABEL_CLASS,
  pinnedLandmarkLabelZoom,
} from "./pinned-landmarks";
export {
  MAX_ROAD_TILES,
  ROAD_SOURCE_LAYER,
  ROAD_TILE_ZOOM,
} from "./road-tiles";
export {
  OBSERVED_POSITION_LABEL_CLASS,
  createObservedPositionLabelElement,
} from "./observed-position-label";

/** The style layer the published styles raise for volumetric building depth. */
export const BUILDING_EXTRUSION_LAYER_ID = "buildings";

/**
 * The museum's terraces round the Motherland, drawn as the monument's own
 * ground beside the generic building extrusion that no longer carries them.
 */
export const MOTHERLAND_TERRACE_LAYER_ID = "nilx-one-motherland-terraces";

/** The style layers whose paint means "a building stands here". */
export const BUILDING_LAYER_IDS: readonly string[] = [
  BUILDING_EXTRUSION_LAYER_ID,
  "buildings-flat",
];

/**
 * How tall the published styles raise a building the data gives no height,
 * as `fill-extrusion-height` falls back to it.
 */
export const BUILDING_DEFAULT_HEIGHT_METERS = 7;

/** The style layers whose paint means "this is water". */
export const WATER_LAYER_IDS: readonly string[] = ["water"];

/** The archive's point-of-interest source layer. */
export {
  LANDMARK_KINDS,
  LANDMARK_TILE_ZOOM,
  POI_SOURCE_LAYER,
} from "./landmark-tiles";

/** Eased camera transitions stay short enough to read as one continuous world. */
export const MAP_CAMERA_TRANSITION_MS = 900;
/** Country-to-local opening flight, without altering normal short camera moves. */
export const MAP_OPENING_FLIGHT_MS = 2_300;

export const MAP_STYLE_CONTRACT_VERSION = "0.1.0";
export const MAP_RENDER_LOAD_TIMEOUT_MS = 10_000;

// One published style document per appearance. Both variants share the same
// layer structure so appearance stays a presentation swap, not a map redesign.
export const MAP_STYLE_URLS: Readonly<Record<MapAppearance, string>> = {
  light: `/map/${MAP_STYLE_CONTRACT_VERSION}/style.json`,
  dark: `/map/${MAP_STYLE_CONTRACT_VERSION}/style-dark.json`,
};

export const MAP_STYLE_URL = MAP_STYLE_URLS[DEFAULT_MAP_APPEARANCE];
export const MAP_BASEMAP_URL = `/map/${MAP_STYLE_CONTRACT_VERSION}/basemap.pmtiles`;

/** Same-origin raster DEM published beside the basemap. */
export const TERRAIN_SOURCE_ID = "terrain";

/** Real terrain stays at measured scale; exaggeration is never used as effect. */
export const TERRAIN_EXAGGERATION = 1;

// Presentation bootstrap only. Natural Earth provides country geography here;
// local detail remains authoritative in the regional Protomaps archive.
export const MAP_BOOTSTRAP_CAMERA: MapCamera = {
  center: [30.5234, 50.4501],
  zoom: 3.3,
  bearing: 0,
  pitch: 0,
};

const pmtilesProtocol = new Protocol();
let pmtilesProtocolRegistered = false;
let workerUrlBound = false;

type MapFactory = (options: MapOptions) => MapLibreMap;

/** A feature the view's loaded tiles hold, with the tile it was read from. */
type ViewFeature = ReturnType<MapLibreMap["querySourceFeatures"]>[number];

/**
 * The card's live body: one off-map preview, made once per card and only shown
 * and hidden after that. `@nilx-one/graphics` answers it by default.
 */
export interface MapLabelBodyPreview {
  show(body: {
    readonly key: string;
    readonly assetUrl: string;
    readonly visibleNodes: readonly string[];
    /** The world's carry, mounted from the same asset the world mounts. */
    readonly backpack: boolean;
  }): void;
  /** The world's clip and phase, applied the way the world applies them. */
  setPose(clipId: string | undefined, phase: number): void;
  setHidden(hidden: boolean): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export type MapLabelBodyPreviewFactory = (
  canvas: HTMLCanvasElement,
  options: {
    readonly reducedMotion: boolean;
    /** Whether the preview has a body standing and can draw it. */
    readonly onReady: (ready: boolean) => void;
  },
) => Promise<MapLabelBodyPreview>;

// The scene library stays out of what everyone downloads to reach the world
// until a card actually has a body to stand in it.
const createGraphicsLabelBodyPreview: MapLabelBodyPreviewFactory = (
  canvas,
  { reducedMotion, onReady },
) =>
  Promise.all([
    import("@nilx-one/graphics"),
    import("./backpack-model"),
    import("three/addons/loaders/GLTFLoader.js"),
  ]).then(([graphics, carry, { GLTFLoader }]) => {
    const preview = graphics.createAvatarPreview(canvas, {
      reducedMotion,
      onStatus: (status) => onReady(status.kind === "ready"),
    });
    // The same carry asset and the same fit the world mounts, so a body
    // handed to the card keeps what it carries.
    const backpackSource = carry.createBackpackSource(
      () => new GLTFLoader().loadAsync(carry.BACKPACK_ASSET_URL),
      () => globalThis.performance.now(),
    );
    const backpack = {
      key: "backpack",
      mount: async (root: Parameters<typeof carry.mountBackpack>[0]) => {
        const asset = await backpackSource.request();
        return asset === undefined
          ? undefined
          : carry.mountBackpack(root, asset.scene);
      },
      dispose: carry.disposeBackpack,
    };
    return {
      show(body) {
        preview.show(body);
        preview.setAttachment(backpack, body.backpack);
      },
      setPose: (clipId, phase) => preview.setPose(clipId, phase),
      setHidden: (hidden) => preview.setHidden(hidden),
      resize: (width, height) => preview.resize(width, height),
      dispose() {
        preview.dispose();
        backpackSource.release();
      },
    };
  });

/** The part of a MapLibre marker the observed-position label depends on. */
export interface MapLabelMarker {
  setLngLat(center: [longitude: number, latitude: number]): void;
  remove(): void;
}

export type MapLabelMarkerFactory = (
  map: MapLibreMap,
  element: HTMLElement,
  center: [longitude: number, latitude: number],
) => MapLabelMarker;

export type MapSelectionMarkerFactory = (
  map: MapLibreMap,
  center: [longitude: number, latitude: number],
) => MapLabelMarker;

/** A single geographic tap acknowledgement: no route or selection ownership. */
export type MapTapFeedbackMarkerFactory = MapLabelMarkerFactory;
export const TAP_FEEDBACK_LIFETIME_MS = 3_000;
export const TAP_FEEDBACK_FADE_MS = 1_000;
export const TAP_FEEDBACK_COLORS = {
  bond: "#37d7e5",
  avaia: "#9b6cfa",
} as const;

export interface MapLibreRenderer extends MapRenderer {
  readonly avatars: AvatarLayerContract;
}

export interface MapLibreRendererOptions {
  readonly styleUrls?: Readonly<Record<MapAppearance, string>>;
  readonly initialAppearance?: MapAppearance;
  readonly initialDimension?: MapDimension;
  readonly initialCamera?: MapCamera;
  readonly createMap?: MapFactory;
  readonly createLabelMarker?: MapLabelMarkerFactory;
  readonly createLabelBodyPreview?: MapLabelBodyPreviewFactory;
  readonly createSelectionMarker?: MapSelectionMarkerFactory;
  readonly createTapFeedbackMarker?: MapTapFeedbackMarkerFactory;
  readonly loadTimeoutMs?: number;
  /**
   * Whether this device has revealed the ground at a point. The composition
   * that draws the fog is the one that knows; absent means the renderer has
   * no fog to consult, and no tap is ever reported as `fog`.
   */
  readonly isGroundRevealed?: (point: MapPointSelection) => boolean;
  /**
   * The fog the composition draws, handed on to the application as
   * `renderer.fog`. When `isGroundRevealed` is absent the renderer answers
   * taps from this instead.
   */
  readonly fog?: MapFogField;
  /**
   * Where `preloadRoads` reads road tiles from. Defaults to the self-hosted
   * basemap archive at `MAP_BASEMAP_URL`; nothing else is ever fetched.
   */
  readonly fetchRoadTile?: FetchRoadTile;
  /**
   * Where `preloadLandmarks` reads landmark tiles from. Defaults to the same
   * self-hosted archive; nothing else is ever fetched.
   */
  readonly fetchLandmarkTile?: FetchLandmarkTile;
}

function createMapLibreLabelMarker(
  map: MapLibreMap,
  element: HTMLElement,
  center: [longitude: number, latitude: number],
): MapLabelMarker {
  const marker = new Marker({
    element,
    anchor: "bottom",
    pitchAlignment: "viewport",
    rotationAlignment: "viewport",
  })
    .setLngLat(center)
    .addTo(map);

  return {
    setLngLat: (next) => {
      marker.setLngLat(next);
    },
    remove: () => marker.remove(),
  };
}

function createMapLibreSelectionMarker(
  map: MapLibreMap,
  center: [longitude: number, latitude: number],
): MapLabelMarker {
  const marker = new Marker({ anchor: "bottom" }).setLngLat(center).addTo(map);
  return {
    setLngLat: (next) => marker.setLngLat(next),
    remove: () => marker.remove(),
  };
}

function createMapLibreTapFeedbackMarker(
  map: MapLibreMap,
  element: HTMLElement,
  center: [longitude: number, latitude: number],
): MapLabelMarker {
  // The centre remains at the tapped geographic coordinate as the camera
  // moves. Like collectible orbs, this bead lies in the map plane.
  const marker = new Marker({
    element,
    anchor: "center",
    pitchAlignment: "map",
    rotationAlignment: "map",
  })
    .setLngLat(center)
    .addTo(map);
  return {
    setLngLat: (next) => marker.setLngLat(next),
    remove: () => marker.remove(),
  };
}

function tapFeedbackElement(seat: "bond" | "avaia"): HTMLElement {
  const element = globalThis.document.createElement("div");
  const color = TAP_FEEDBACK_COLORS[seat];
  element.className = "map-ground-tap-feedback";
  element.dataset.seat = seat;
  element.setAttribute("aria-hidden", "true");
  element.style.position = "relative";
  element.style.width = "28px";
  element.style.height = "28px";
  element.style.pointerEvents = "none";
  element.style.opacity = "1";
  element.style.transition = `opacity ${TAP_FEEDBACK_FADE_MS}ms ease-out`;

  // Follow the collectible orb's visual language: a pale, luminous core
  // inside a soft seat-colored halo, rather than a destination-pin outline.
  const halo = globalThis.document.createElement("span");
  halo.className = "map-ground-tap-feedback__halo";
  halo.style.position = "absolute";
  halo.style.inset = "0";
  halo.style.borderRadius = "50%";
  halo.style.backgroundColor = `${color}20`;
  halo.style.backgroundImage = `radial-gradient(circle, ${color}80 0%, ${color}42 26%, transparent 72%)`;
  halo.style.filter = "blur(2px)";
  halo.style.pointerEvents = "none";

  const orb = globalThis.document.createElement("span");
  orb.className = "map-ground-tap-feedback__orb";
  orb.style.position = "absolute";
  orb.style.left = "50%";
  orb.style.top = "50%";
  orb.style.transform = "translate(-50%, -50%)";
  orb.style.width = "10px";
  orb.style.height = "10px";
  orb.style.boxSizing = "border-box";
  orb.style.border = `1px solid ${color}`;
  orb.style.borderRadius = "50%";
  orb.style.backgroundColor = "#f2fdff";
  orb.style.backgroundImage = `radial-gradient(circle at 30% 25%, #ffffff 0%, #f2fdff 29%, ${color} 100%)`;
  orb.style.boxShadow = `0 0 4px ${color}b3, 0 0 10px ${color}80`;
  orb.style.pointerEvents = "none";

  element.append(halo, orb);
  return element;
}

/**
 * Whether a MapLibre gesture's DOM event came from a finger: a touch event,
 * or a pointer event a touch screen produced.
 */
function isTouchEvent(event: unknown): boolean {
  if (typeof event !== "object" || event === null) return false;
  const { type, pointerType } = event as {
    readonly type?: unknown;
    readonly pointerType?: unknown;
  };
  return (
    pointerType === "touch" ||
    (typeof type === "string" && type.startsWith("touch"))
  );
}

export function resolvePmtilesProtocolUrl(
  url: string,
  baseUrl: string,
): string {
  if (!url.startsWith("pmtiles:///")) {
    return url;
  }

  const transportUrl = new URL(url.slice("pmtiles://".length), baseUrl).href;
  return `pmtiles://${transportUrl}`;
}

function ensurePmtilesProtocol(): void {
  if (pmtilesProtocolRegistered) {
    return;
  }

  const loadPmtiles: Parameters<typeof addProtocol>[1] = (
    request,
    abortController,
  ) =>
    pmtilesProtocol.tile(
      {
        ...request,
        url: resolvePmtilesProtocolUrl(request.url, globalThis.location.href),
      },
      abortController,
    );

  addProtocol("pmtiles", loadPmtiles);
  pmtilesProtocolRegistered = true;
}

// A host that publishes the worker somewhere else has already said so; this
// only replaces MapLibre's module-relative default, which no bundled build can
// resolve.
function ensureWorkerUrl(): void {
  if (workerUrlBound) {
    return;
  }

  if (getWorkerUrl() === "") {
    setWorkerUrl(maplibreWorkerUrl);
  }

  workerUrlBound = true;
}

function validPoint(point: MapPointSelection): boolean {
  return (
    Number.isFinite(point.longitude) &&
    Number.isFinite(point.latitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180 &&
    point.latitude >= -90 &&
    point.latitude <= 90
  );
}

/** An optional layer whose code failed to load is already recorded as failed. */
function ignoreOptionalLayer(): void {}

export function createMapLibreRenderer(
  options: MapLibreRendererOptions = {},
): MapLibreRenderer {
  const styleUrls = options.styleUrls ?? MAP_STYLE_URLS;
  const initialCamera = options.initialCamera ?? MAP_BOOTSTRAP_CAMERA;
  const loadTimeoutMs = options.loadTimeoutMs ?? MAP_RENDER_LOAD_TIMEOUT_MS;
  const createMap =
    options.createMap ?? ((mapOptions) => new MapLibreMap(mapOptions));
  const createLabelMarker =
    options.createLabelMarker ?? createMapLibreLabelMarker;
  const createLabelBodyPreview =
    options.createLabelBodyPreview ?? createGraphicsLabelBodyPreview;
  const createSelectionMarker =
    options.createSelectionMarker ?? createMapLibreSelectionMarker;
  const createTapFeedbackMarker =
    options.createTapFeedbackMarker ?? createMapLibreTapFeedbackMarker;
  // The archive is opened on the first road tile asked for, not before.
  let archiveRoads: FetchRoadTile | undefined;
  const roadTiles = createRoadTileCache({
    fetchTile:
      options.fetchRoadTile ??
      ((tile) => {
        archiveRoads ??= pmtilesRoadTiles(
          new URL(MAP_BASEMAP_URL, globalThis.location.href).href,
        );
        return archiveRoads(tile);
      }),
  });
  let archiveLandmarks: FetchLandmarkTile | undefined;
  const landmarkTiles = createLandmarkTileCache({
    fetchTile:
      options.fetchLandmarkTile ??
      ((tile) => {
        archiveLandmarks ??= pmtilesLandmarkTiles(
          new URL(MAP_BASEMAP_URL, globalThis.location.href).href,
        );
        return archiveLandmarks(tile);
      }),
  });
  let appearance = options.initialAppearance ?? DEFAULT_MAP_APPEARANCE;
  let dimension = options.initialDimension ?? DEFAULT_MAP_DIMENSION;
  let status: MapRendererStatus = { kind: "unmounted" };
  let camera: MapCamera = initialCamera;
  let zoomPivot: MapZoomPivot = "pointer";
  let map: MapLibreMap | undefined;
  let viewportCleanup: (() => void) | undefined;
  /** Fingers and mouse buttons on the map right now. */
  const pressedPointers = new Set<number>();
  let avatarLayer: AvatarCustomLayer | undefined;
  let avatarLayerPromise: Promise<AvatarCustomLayer> | undefined;
  const avatarHandles = new Map<string, AvatarHandle>();
  const droneHandles = new Map<string, SystemDroneHandle>();
  const animalHandles = new Map<string, AmbientAnimalHandle>();
  let flightLootHandles: readonly MapFlightLoot[] = [];
  let droneLayerFailed = false;
  let avatarCamera: MapCamera = camera;
  let monumentLayer: MonumentCustomLayer | undefined;
  let monumentLayerPromise: Promise<MonumentCustomLayer> | undefined;
  // A layer's code that could not be loaded (offline, or a hashed chunk a
  // newer deploy no longer serves) is an optional model missing, the same as
  // a missing asset: the world is shown without it rather than held back.
  // The rejected import is kept, as before, so a body upserted every frame
  // never re-requests a chunk that is gone.
  let monumentLayerFailed = false;
  let avatarLayerFailed = false;
  let vegetationLayer: VegetationCustomLayer | undefined;
  let vegetationLayerPromise: Promise<VegetationCustomLayer> | undefined;
  let vegetationPlanted: readonly VegetationInstance[] = [];
  let vegetationKey = "";

  /**
   * A fixed landmark, not a handle the application drives: it is requested
   * once, the first time presentation is applied, and stays for the life of
   * the renderer.
   */
  function requestMonumentLayer(): Promise<MonumentCustomLayer> {
    if (monumentLayer !== undefined) return Promise.resolve(monumentLayer);
    if (monumentLayerPromise !== undefined) return monumentLayerPromise;
    monumentLayerPromise = import("./monument-layer").then(
      ({ createMonumentLayer }) => {
        const layer = createMonumentLayer({
          onModel: () => {
            if (map !== undefined) applyMonumentCutout(map);
          },
        });
        monumentLayer = layer;
        monumentLayerFailed = false;
        layer.setDimension(dimension);
        layer.setAppearance(appearance);
        if (map !== undefined && firstPaintDone) ensureMonumentLayer(map);
        return layer;
      },
      (error: unknown) => {
        monumentLayerFailed = true;
        map?.triggerRepaint();
        throw error;
      },
    );
    return monumentLayerPromise;
  }

  /**
   * Trees and bushes are requested the first time a view close enough to
   * show them has green areas in it: a session that never zooms in to a
   * park never downloads them.
   */
  function requestVegetationLayer(): Promise<VegetationCustomLayer> {
    if (vegetationLayer !== undefined) return Promise.resolve(vegetationLayer);
    if (vegetationLayerPromise !== undefined) return vegetationLayerPromise;
    vegetationLayerPromise = import("./vegetation-layer").then(
      ({ createVegetationLayer }) => {
        const layer = createVegetationLayer();
        vegetationLayer = layer;
        layer.setDimension(dimension);
        layer.setInstances(vegetationPlanted);
        if (map !== undefined && firstPaintDone) ensureVegetationLayer(map);
        return layer;
      },
    );
    return vegetationLayerPromise;
  }

  function ensureVegetationLayer(mounted: MapLibreMap): void {
    if (vegetationLayer === undefined) return;
    if (mounted.getLayer(vegetationLayer.id) !== undefined) return;
    mounted.addLayer(vegetationLayer);
  }

  /** The polygons a style layer paints in the view, outer ring first. */
  function viewPolygons(
    mounted: MapLibreMap,
    layerId: string,
    bounds: MapBounds,
  ): AreaPolygon[] {
    return polygonsPainted(mounted, layerId, bounds).polygons as AreaPolygon[];
  }

  /**
   * The green landuse the view's tiles hold that touches a box: the kinds
   * the `parks` layer paints, each polygon on its own.
   */
  function greenAreasIn(bounds: MapBounds): GreenArea[] {
    const areas: GreenArea[] = [];
    for (const feature of viewFeatures(LANDUSE_SOURCE_LAYER)) {
      const kind = feature.properties?.["kind"];
      if (typeof kind !== "string" || GREEN_CHARACTER[kind] === undefined)
        continue;
      const geometry = feature.geometry as {
        readonly type: string;
        readonly coordinates: unknown;
      };
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates as AreaPolygon]
          : geometry.type === "MultiPolygon"
            ? (geometry.coordinates as AreaPolygon[])
            : [];
      for (const polygon of polygons) {
        const outer = polygon[0];
        if (outer === undefined || !ringTouches(outer, bounds)) continue;
        areas.push({ kind, polygon });
      }
    }
    return areas;
  }

  /**
   * Plants the green areas the view's tiles hold, once the view has settled.
   * Closer than street scale only, and only in volumetric presentation: the
   * same rule the monument keeps.
   */
  function updateVegetation(mounted: MapLibreMap): void {
    const zoom = mounted.getZoom();
    if (zoom < VEGETATION_MIN_ZOOM || dimension !== "volumetric") {
      if (vegetationPlanted.length > 0) {
        vegetationPlanted = [];
        vegetationKey = "";
        vegetationLayer?.setInstances([]);
      }
      return;
    }
    const view = mounted.getBounds();
    const padX = (view.getEast() - view.getWest()) * 0.1;
    const padY = (view.getNorth() - view.getSouth()) * 0.1;
    const bounds: MapBounds = {
      west: view.getWest() - padX,
      south: view.getSouth() - padY,
      east: view.getEast() + padX,
      north: view.getNorth() + padY,
    };
    const areas = greenAreasIn(bounds);
    const center = mounted.getCenter();
    const key = [
      areas.length,
      bounds.west.toFixed(4),
      bounds.south.toFixed(4),
      bounds.east.toFixed(4),
      bounds.north.toFixed(4),
    ].join(":");
    if (key === vegetationKey) return;
    vegetationKey = key;
    if (areas.length === 0) {
      if (vegetationPlanted.length > 0) {
        vegetationPlanted = [];
        vegetationLayer?.setInstances([]);
      }
      return;
    }
    const obstacles = [
      ...viewPolygons(mounted, BUILDING_EXTRUSION_LAYER_ID, bounds),
      ...viewPolygons(mounted, "water", bounds),
    ];
    const { trees, bushes } = plantVegetation({
      areas,
      obstacles,
      bounds,
      center: [center.lng, center.lat],
    });
    // Ground this device has not revealed keeps its fog: nothing stands on it.
    vegetationPlanted = [...trees, ...bushes].filter(
      (plant) =>
        isGroundRevealed?.({
          longitude: plant.lngLat[0],
          latitude: plant.lngLat[1],
        }) !== false,
    );
    if (vegetationLayer !== undefined)
      vegetationLayer.setInstances(vegetationPlanted);
    else void requestVegetationLayer().catch(ignoreOptionalLayer);
  }

  function requestAvatarLayer(): Promise<AvatarCustomLayer> {
    if (avatarLayer !== undefined) return Promise.resolve(avatarLayer);
    if (avatarLayerPromise !== undefined) return avatarLayerPromise;
    avatarLayerPromise = import("./avatar-layer").then(
      ({ createAvatarLayer }) => {
        const layer = createAvatarLayer({
          requestMount: () => {
            if (map !== undefined && firstPaintDone) ensureAvatarLayer(map);
          },
        });
        avatarLayer = layer;
        avatarLayerFailed = false;
        layer.setCamera(avatarCamera);
        for (const handle of avatarHandles.values()) layer.upsert(handle);
        for (const handle of droneHandles.values()) layer.upsertDrone(handle);
        for (const handle of animalHandles.values()) layer.upsertAnimal(handle);
        layer.setFlightLoot(flightLootHandles);
        if (map !== undefined && firstPaintDone && layer.hasInstances()) {
          ensureAvatarLayer(map);
        }
        return layer;
      },
      (error: unknown) => {
        avatarLayerFailed = true;
        map?.triggerRepaint();
        throw error;
      },
    );
    return avatarLayerPromise;
  }

  const droneActivationListeners = new Map<string, Set<() => void>>();
  const systemDrone: SystemDroneLayerContract = {
    subscribeActivation(id, listener) {
      const listeners = droneActivationListeners.get(id) ?? new Set();
      listeners.add(listener);
      droneActivationListeners.set(id, listeners);
      return () => {
        listeners.delete(listener);
        if (
          listeners.size === 0 &&
          droneActivationListeners.get(id) === listeners
        )
          droneActivationListeners.delete(id);
      };
    },
    upsert(handle) {
      droneHandles.set(handle.id, handle);
      if (avatarLayer !== undefined) return avatarLayer.upsertDrone(handle);
      if (droneLayerFailed) return false;
      void requestAvatarLayer().catch(() => {
        // The informer keeps its independent text/SVG fallback if this chunk
        // cannot load. A later publication may retry the capability.
        avatarLayerPromise = undefined;
        droneLayerFailed = droneHandles.size > 0;
      });
      return false;
    },
    remove(id) {
      droneHandles.delete(id);
      if (droneHandles.size === 0) droneLayerFailed = false;
      avatarLayer?.remove(id);
    },
  };
  // Scenery, like the ambient drones: never hit tested, never a body.
  const animals: AmbientAnimalLayerContract = {
    upsert(handle) {
      animalHandles.set(handle.id, handle);
      if (avatarLayer !== undefined) avatarLayer.upsertAnimal(handle);
      else void requestAvatarLayer().catch(ignoreOptionalLayer);
    },
    remove(id) {
      animalHandles.delete(id);
      avatarLayer?.removeAnimal(id);
    },
  };
  const avatars: AvatarLayerContract = {
    upsert(handle) {
      avatarHandles.set(handle.id, handle);
      if (avatarLayer !== undefined) avatarLayer.upsert(handle);
      else void requestAvatarLayer().catch(ignoreOptionalLayer);
      if (handle.id === observedLabel?.bodyId) applyLabelBody();
    },
    remove(id) {
      avatarHandles.delete(id);
      avatarLayer?.remove(id);
      if (id === observedLabel?.bodyId) applyLabelBody();
    },
    setCamera(next) {
      avatarCamera = next;
      avatarLayer?.setCamera(next);
    },
  };
  let loadTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  // Style documents resolve before sources and tiles do, so the phase a
  // failure arrives in is what distinguishes a missing style from a missing
  // basemap from ordinary tile noise on a map that already renders.
  let styleResolved = false;
  // styledata only announces a change; style.load is the boundary at which
  // a frame can paint, even while tiles keep MapLibre load pending.
  let styleReadyForPaint = false;
  let firstPaintDone = false;
  // A style swap discards every source and layer the renderer owns, so the
  // presentation the application already set has to be reapplied rather than
  // silently lost. This flag is what a style reload resets.
  let presentationApplied = false;
  // Bridges built from the loaded roads, and a fingerprint of what was last
  // handed to the source so an unchanged view is not uploaded again.
  let bridgeData: BridgeStructures = {
    type: "FeatureCollection",
    features: [],
  };
  let bridgeFingerprint = "";
  let observedPosition: MapObservedPosition | null = null;
  let observedLabel: MapObservedPositionLabel | null = null;
  let labelMarker: MapLabelMarker | undefined;
  let labelElement: HTMLElement | undefined;
  let labelBody: MapLabelBodyPreview | undefined;
  let labelBodyRequested = false;
  let labelBodyReady = false;
  let selectionPoint: MapPointSelection | null = null;
  let selectionMarker: MapLabelMarker | undefined;
  interface TapFeedbackEntry {
    readonly marker: MapLabelMarker;
    readonly element: HTMLElement;
    readonly expiresAt: number;
    fadeTimer?: ReturnType<typeof globalThis.setTimeout>;
    removeTimer?: ReturnType<typeof globalThis.setTimeout>;
  }
  const tapFeedbackEntries: TapFeedbackEntry[] = [];
  let fogMarks: readonly MapFogMark[] = [];
  let fogPulseFrame: number | undefined;
  let pinnedLandmarks: readonly MapPinnedLandmark[] = [];
  let orbs: readonly MapOrb[] = [];
  let route: MapRoute | null = null;
  let orbFallFrame: number | undefined;
  let orbGlowTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let orbFlightRoot: HTMLElement | undefined;
  const orbFlights = new Map<
    string,
    {
      readonly element: HTMLElement;
      readonly bead: HTMLElement;
      readonly trail: readonly HTMLElement[];
      readonly ring: HTMLElement;
    }
  >();
  const pinnedLabels = new Map<
    string,
    { readonly element: HTMLElement; readonly marker: MapLabelMarker }
  >();
  const isGroundRevealed =
    options.isGroundRevealed ??
    (options.fog === undefined
      ? undefined
      : (point: MapPointSelection) => {
          const fog = options.fog;
          return (
            fog === undefined ||
            !fog.isActive() ||
            fog.isRevealed(fog.cellAt(point).id)
          );
        });
  const listeners = new Set<(next: MapRendererStatus) => void>();
  const cameraListeners = new Set<(change: MapCameraChange) => void>();
  const bodyActivationListeners = new Set<
    (activation: MapBodyActivation) => void
  >();
  const pointSelectionListeners = new Set<(point: MapPointSelection) => void>();
  const groundTapListeners = new Set<(tap: MapGroundTap) => void>();
  const landmarkListeners = new Set<() => void>();

  function clearLoadTimer(): void {
    if (loadTimer === undefined) {
      return;
    }
    globalThis.clearTimeout(loadTimer);
    loadTimer = undefined;
  }

  function publish(next: MapRendererStatus): void {
    status = next;
    if (
      next.kind === "ready" ||
      next.kind === "unavailable" ||
      next.kind === "unmounted"
    ) {
      clearLoadTimer();
    }
    for (const listener of listeners) {
      listener(next);
    }
  }

  function completeFirstPaint(
    mountedMap: MapLibreMap,
    container: HTMLElement,
  ): void {
    if (firstPaintDone) return;
    // A late visible frame may recover a timeout, not an actual renderer
    // failure (including missing WebGL and failed basemap resources).
    if (
      status.kind !== "loading" &&
      !(
        status.kind === "unavailable" &&
        (status.reason === "first-paint-timeout" ||
          status.reason === "style-load-timeout")
      )
    ) {
      return;
    }

    // An embedded WebView may paint before its container has a real size.
    // Hold readiness until the host has actually measured a viewport.
    if (container.isConnected) {
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
    }

    firstPaintDone = true;
    applyPresentation(mountedMap);
    publish({ kind: "ready" });
  }

  function reportRendererError(error?: unknown): void {
    if (status.kind === "unavailable") {
      return;
    }

    // A client without a WebGL2 context is a capability answer, not a data
    // answer: MapLibre reports it through the same error channel as a missing
    // style, so it has to be read off the error before the load phases are.
    if (error instanceof GPUInitializationError) {
      publish({ kind: "unavailable", reason: "webgl-unavailable" });
      return;
    }

    if (!styleResolved) {
      publish({ kind: "unavailable", reason: "style-load-failed" });
      return;
    }

    if (!firstPaintDone) {
      publish({ kind: "unavailable", reason: "basemap-load-failed" });
    }
  }

  function readCamera(mounted: MapLibreMap): MapCamera {
    const center = mounted.getCenter();
    return {
      center: [center.lng, center.lat],
      zoom: mounted.getZoom(),
      bearing: mounted.getBearing(),
      pitch: mounted.getPitch(),
    };
  }

  function publishCamera(
    gesture: boolean,
    phase: "start" | "end",
    originalEvent?: unknown,
  ): void {
    if (map === undefined) {
      return;
    }
    camera = readCamera(map);
    avatars.setCamera(camera);
    const touch = isTouchEvent(originalEvent);
    for (const listener of cameraListeners) {
      listener({ camera, gesture, phase, ...(touch ? { touch } : {}) });
    }
  }

  // MapLibre reads `around` only as a handler is enabled, and its scroll
  // handler ignores a second enable, so a new pivot re-enables what is on.
  function applyZoomPivot(mounted: MapLibreMap): void {
    const around =
      zoomPivot === "center" ? { around: "center" as const } : undefined;
    const scroll = mounted.scrollZoom;
    if (scroll?.isEnabled()) {
      scroll.disable();
      scroll.enable(around);
    }
    const touch = mounted.touchZoomRotate;
    if (touch?.isEnabled()) touch.enable(around);
  }

  function applyDimension(mounted: MapLibreMap): void {
    // The monument is its own custom layer, not a style layer, so it follows
    // dimension whether or not the published style still carries an
    // extrusion layer to match.
    monumentLayer?.setDimension(dimension);
    vegetationLayer?.setDimension(dimension);

    // Terrain and building mass are two views of the same geographic
    // presentation switch. Explicit flat mode disables both; volumetric mode
    // uses the measured DEM at 1:1 scale when the published style provides it.
    if (
      dimension === "volumetric" &&
      mounted.getSource(TERRAIN_SOURCE_ID) !== undefined
    ) {
      mounted.setTerrain({
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION,
      });
    } else {
      mounted.setTerrain(null);
    }

    // A bridge's deck and piers are depth too; the style's flat deck stays.
    for (const id of [BRIDGE_DECK_LAYER_ID, BRIDGE_PIER_LAYER_ID]) {
      if (mounted.getLayer(id) !== undefined)
        mounted.setLayoutProperty(
          id,
          "visibility",
          dimension === "flat" ? "none" : "visible",
        );
    }

    // The footprints remain underneath the extrusion, so hiding depth never
    // removes buildings from the geographic map.
    for (const id of [
      BUILDING_EXTRUSION_LAYER_ID,
      MOTHERLAND_TERRACE_LAYER_ID,
    ]) {
      if (mounted.getLayer(id) === undefined) continue;
      mounted.setLayoutProperty(
        id,
        "visibility",
        dimension === "flat" ? "none" : "visible",
      );
    }
  }

  /**
   * The museum's stepped terraces under the Motherland are the monument's
   * ground, not a building: they leave the generic extrusion and stand in a
   * layer of their own, just above it, in the colour of the land around.
   * Their height, base and fade-in are the extrusion's own, as the
   * published styles set them, so the walk reads them exactly as before.
   */
  function applyMotherlandTerraces(mounted: MapLibreMap): void {
    const buildings = mounted.getLayer(BUILDING_EXTRUSION_LAYER_ID) as
      | {
          readonly source?: string;
          readonly sourceLayer?: string;
          readonly filter?: FilterSpecification | null;
        }
      | undefined;
    if (buildings?.source === undefined) return;
    if (mounted.getLayer(MOTHERLAND_TERRACE_LAYER_ID) === undefined) {
      const order = mounted.getLayersOrder?.() ?? [];
      const above = order[order.indexOf(BUILDING_EXTRUSION_LAYER_ID) + 1];
      mounted.addLayer(
        {
          id: MOTHERLAND_TERRACE_LAYER_ID,
          type: "fill-extrusion",
          source: buildings.source,
          ...(buildings.sourceLayer === undefined
            ? {}
            : { "source-layer": buildings.sourceLayer }),
          minzoom: 14,
          filter: onlyMotherlandTerraces(buildings.filter),
          layout: { visibility: dimension === "flat" ? "none" : "visible" },
          paint: {
            "fill-extrusion-color": MOTHERLAND_TERRACE_COLORS[appearance],
            "fill-extrusion-height": [
              "coalesce",
              ["get", "height"],
              BUILDING_DEFAULT_HEIGHT_METERS,
            ],
            "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
            "fill-extrusion-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              15,
              0,
              16.5,
              0.96,
            ],
            "fill-extrusion-vertical-gradient": true,
          },
        },
        above,
      );
    }
    if (!carriesMotherlandTerraces(buildings.filter)) {
      mounted.setFilter(
        BUILDING_EXTRUSION_LAYER_ID,
        withoutMotherlandTerraces(buildings.filter),
      );
    }
  }

  /**
   * Where the bodies currently stand on the screen. The handles are the ones
   * the application is already drawing, so this projects what is on the world
   * rather than deriving a second geography of its own.
   */
  function drawnBodies(mounted: MapLibreMap): DrawnBody[] {
    const zoom = mounted.getZoom();
    return [...avatarHandles.values()]
      .filter((handle) => handle.visible)
      .map((handle) => {
        const [longitude, latitude] = handle.lngLat;
        const feet = mounted.project([longitude, latitude]);
        return {
          id: handle.id,
          feet: { x: feet.x, y: feet.y },
          heightPixels:
            (MAP_BODY_HEIGHT_METERS * handle.scale) /
            mapMetersPerPixel(latitude, zoom),
        };
      });
  }

  function updateLabelVisibility(mounted: MapLibreMap): void {
    if (labelElement === undefined) {
      return;
    }
    // The label and the body take turns: closer than the handover the body is
    // on the world and speaks for itself, and a card over its head would only
    // repeat it. Further out the body is gone, and the card is what is left.
    // A body that is talking keeps its card at every scale: the line is the
    // card's to carry, and hiding it would be the body falling silent.
    const speaking = (observedLabel?.speech ?? "").length > 0;
    setPartShown(
      labelElement,
      speaking || mounted.getZoom() < MAP_BODY_HANDOVER_ZOOM,
      "flex",
    );
    applyLabelBody();
  }

  function requestLabelBody(element: HTMLElement): void {
    const canvas = labelBodyCanvas(element);
    if (labelBodyRequested || canvas === null) return;
    // Asked for once per card. A host that cannot draw it keeps the still.
    labelBodyRequested = true;
    void createLabelBodyPreview(canvas, {
      reducedMotion: prefersReducedMotion(globalThis.document),
      onReady: (ready) => {
        labelBodyReady = ready;
        applyLabelBody();
      },
    })
      .then((preview) => {
        if (labelElement !== element) {
          preview.dispose();
          return;
        }
        const density = globalThis.devicePixelRatio || 1;
        preview.resize(LABEL_BODY_WIDTH * density, LABEL_BODY_HEIGHT * density);
        labelBody = preview;
        applyLabelBody();
      })
      .catch(() => undefined);
  }

  /**
   * The card's own body takes turns with the world's. While the world draws
   * the body the card speaks for, the card does not; while the world hides it,
   * the card stands the same study, outfit and clip beside its text. Both were
   * drawn once and are only shown and hidden after that.
   */
  function applyLabelBody(): void {
    const element = labelElement;
    if (element === undefined) return;
    const bodyId = observedLabel?.bodyId;
    const handle = bodyId === undefined ? undefined : avatarHandles.get(bodyId);
    const worldHidden = handle?.visible !== true;
    const live =
      handle !== undefined &&
      worldHidden &&
      labelMarker !== undefined &&
      !element.hidden;
    if (live) {
      requestLabelBody(element);
      const visibleNodes = handle.visibleNodes ?? [];
      labelBody?.show({
        key: `${handle.modelId}#${visibleNodes.join("|")}`,
        assetUrl: avatarAssetUrl(handle.modelId),
        visibleNodes,
        backpack: handle.backpack === true,
      });
      // Every update seeks, as the world's own does, so the pose handed
      // across in either direction is the one the other side was standing in.
      labelBody?.setPose(handle.clipId, handle.clipPhase);
    }
    const drawn = live && labelBody !== undefined && labelBodyReady;
    labelBody?.setHidden(!drawn);
    setLabelBody(
      element,
      drawn
        ? "model"
        : worldHidden && observedLabel?.avatarUrl !== undefined
          ? "still"
          : "none",
    );
  }

  function applyLabel(mounted: MapLibreMap): void {
    if (observedPosition === null || observedLabel === null) {
      // The marker goes; the card and the body standing in it are kept,
      // hidden, so the next card is the same one rather than a fresh load.
      labelMarker?.remove();
      labelMarker = undefined;
      applyLabelBody();
      return;
    }

    const anchor = observedLabel.at ?? observedPosition.center;
    const center: [number, number] = [anchor[0], anchor[1]];

    if (labelElement === undefined) {
      labelElement = createObservedPositionLabelElement(globalThis.document);
    }
    applyObservedPositionLabel(labelElement, observedLabel, appearance);

    if (labelMarker === undefined) {
      labelMarker = createLabelMarker(mounted, labelElement, center);
    } else {
      labelMarker.setLngLat(center);
    }

    updateLabelVisibility(mounted);
  }

  function applySelectionPoint(mounted: MapLibreMap): void {
    if (selectionPoint === null) {
      selectionMarker?.remove();
      selectionMarker = undefined;
      return;
    }

    const center: [number, number] = [
      selectionPoint.longitude,
      selectionPoint.latitude,
    ];
    if (selectionMarker === undefined) {
      selectionMarker = createSelectionMarker(mounted, center);
    } else {
      selectionMarker.setLngLat(center);
    }
  }

  function removeObservedPositionLayers(mounted: MapLibreMap): void {
    for (const layerId of [
      OBSERVED_POSITION_ACCURACY_LAYER_ID,
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
      OBSERVED_POSITION_EDGE_LAYER_ID,
      OBSERVED_POSITION_POINT_LAYER_ID,
    ]) {
      if (mounted.getLayer(layerId) !== undefined) {
        mounted.removeLayer(layerId);
      }
    }
    if (mounted.getSource(OBSERVED_POSITION_SOURCE_ID) !== undefined) {
      mounted.removeSource(OBSERVED_POSITION_SOURCE_ID);
    }
  }

  function applyObservedPosition(mounted: MapLibreMap): void {
    if (observedPosition === null) {
      removeObservedPositionLayers(mounted);
      applyLabel(mounted);
      return;
    }

    const source = mounted.getSource(OBSERVED_POSITION_SOURCE_ID) as
      GeoJSONSource | undefined;
    const specification = observedPositionSource(observedPosition);

    if (source === undefined) {
      mounted.addSource(
        OBSERVED_POSITION_SOURCE_ID,
        specification as unknown as SourceSpecification,
      );
    } else {
      // A live observation updates the data in place: recreating the source
      // would rebuild the basemap's neighbours along with it.
      source.setData(
        (specification as { readonly data: unknown }).data as Parameters<
          GeoJSONSource["setData"]
        >[0],
      );
    }

    for (const layer of observedPositionLayers(observedPosition)) {
      const layerId = String(layer.id);
      if (mounted.getLayer(layerId) === undefined) {
        // Appended last, so the observation stays above the basemap and the
        // close-zoom building volumes without reordering the published style.
        mounted.addLayer(layer as unknown as LayerSpecification);
        continue;
      }
      if (layerId === OBSERVED_POSITION_ACCURACY_LAYER_ID) {
        // Accuracy is baked into a zoom expression, so a new observation
        // repaints the radius rather than rebuilding the layer.
        mounted.setPaintProperty(
          layerId,
          "circle-radius",
          accuracyRadiusExpression(
            observedPosition,
          ) as DataDrivenPropertyValueSpecification<number>,
        );
      }
    }

    applyLabel(mounted);
  }

  function stopFogPulse(): void {
    if (fogPulseFrame === undefined) return;
    globalThis.cancelAnimationFrame(fogPulseFrame);
    fogPulseFrame = undefined;
  }

  // A cell being worked open breathes for as long as its job runs; a cell
  // that is merely in reach, or a prompt dismissed before a job ever starts,
  // never enters this loop, and one already running stops the moment no
  // cell is left revealing — cancelling the reveal is what cancels this.
  function tickFogPulse(): void {
    fogPulseFrame = undefined;
    if (
      map === undefined ||
      !fogMarks.some((mark) => mark.state === "revealing")
    ) {
      return;
    }
    const source = map.getSource(FOG_MARKS_SOURCE_ID) as
      GeoJSONSource | undefined;
    source?.setData(
      fogMarksData(fogMarks, fogPulseLevel(Date.now())) as Parameters<
        GeoJSONSource["setData"]
      >[0],
    );
    fogPulseFrame = globalThis.requestAnimationFrame(tickFogPulse);
  }

  function ensureFogPulse(): void {
    if (fogPulseFrame !== undefined) return;
    if (!fogMarks.some((mark) => mark.state === "revealing")) return;
    fogPulseFrame = globalThis.requestAnimationFrame(tickFogPulse);
  }

  function applyFogMarks(mounted: MapLibreMap): void {
    if (fogMarks.length === 0) {
      stopFogPulse();
      for (const layerId of [
        FOG_MARKS_FILL_LAYER_ID,
        FOG_MARKS_OUTLINE_LAYER_ID,
      ]) {
        if (mounted.getLayer(layerId) !== undefined)
          mounted.removeLayer(layerId);
      }
      if (mounted.getSource(FOG_MARKS_SOURCE_ID) !== undefined) {
        mounted.removeSource(FOG_MARKS_SOURCE_ID);
      }
      return;
    }

    const pulse = fogPulseLevel(Date.now());
    const source = mounted.getSource(FOG_MARKS_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) {
      mounted.addSource(
        FOG_MARKS_SOURCE_ID,
        fogMarksSource(fogMarks) as unknown as SourceSpecification,
      );
    } else {
      source.setData(
        fogMarksData(fogMarks, pulse) as Parameters<
          GeoJSONSource["setData"]
        >[0],
      );
    }
    // Beneath the observation, so the Bond's own marker stays on top of the
    // cells around it; the observation layers are appended after these.
    const before = [
      PINNED_LANDMARKS_GLOW_LAYER_ID,
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of fogMarksLayers()) {
      if (mounted.getLayer(String(layer.id)) === undefined) {
        mounted.addLayer(layer as unknown as LayerSpecification, before);
      }
    }
    ensureFogPulse();
  }

  function releasePinnedLabels(): void {
    for (const { marker } of pinnedLabels.values()) marker.remove();
    pinnedLabels.clear();
  }

  function updatePinnedLabelVisibility(mounted: MapLibreMap): void {
    if (pinnedLabels.size === 0) return;
    const canvas = mounted.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const viewport =
      width > 0 && height > 0
        ? { width, height, topInset: 76, bottomInset: 160 }
        : undefined;
    const shown = layoutPinnedLabels(
      pinnedLandmarks.map((landmark) => {
        const { x, y } = mounted.project([
          landmark.longitude,
          landmark.latitude,
        ]);
        return {
          id: landmark.id,
          weight: landmark.weight,
          title: landmark.title,
          ...(landmark.detail === undefined ? {} : { detail: landmark.detail }),
          x,
          y,
        };
      }),
      mounted.getZoom(),
      viewport,
    );
    for (const [id, { element }] of pinnedLabels) {
      setPinnedLandmarkLabelShown(element, shown.has(id));
      setPinnedLandmarkCardOffset(element, shown.get(id) ?? 0, width);
    }
  }

  function applyPinnedLandmarkLabels(mounted: MapLibreMap): void {
    const wanted = new Set(pinnedLandmarks.map((landmark) => landmark.id));
    for (const [id, { marker }] of pinnedLabels) {
      if (wanted.has(id)) continue;
      marker.remove();
      pinnedLabels.delete(id);
    }
    for (const landmark of pinnedLandmarks) {
      const center: [number, number] = [landmark.longitude, landmark.latitude];
      const existing = pinnedLabels.get(landmark.id);
      if (existing !== undefined) {
        applyPinnedLandmarkLabel(existing.element, landmark, appearance);
        existing.marker.setLngLat(center);
        continue;
      }
      const element = createPinnedLandmarkLabelElement(globalThis.document);
      applyPinnedLandmarkLabel(element, landmark, appearance);
      pinnedLabels.set(landmark.id, {
        element,
        marker: createLabelMarker(mounted, element, center),
      });
    }
    updatePinnedLabelVisibility(mounted);
  }

  function applyPinnedLandmarks(mounted: MapLibreMap): void {
    if (pinnedLandmarks.length === 0) {
      for (const layerId of [
        PINNED_LANDMARKS_GLOW_LAYER_ID,
        PINNED_LANDMARKS_POINT_LAYER_ID,
      ]) {
        if (mounted.getLayer(layerId) !== undefined)
          mounted.removeLayer(layerId);
      }
      if (mounted.getSource(PINNED_LANDMARKS_SOURCE_ID) !== undefined) {
        mounted.removeSource(PINNED_LANDMARKS_SOURCE_ID);
      }
      releasePinnedLabels();
      return;
    }

    const source = mounted.getSource(PINNED_LANDMARKS_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) {
      mounted.addSource(
        PINNED_LANDMARKS_SOURCE_ID,
        pinnedLandmarksSource(
          pinnedLandmarks,
        ) as unknown as SourceSpecification,
      );
    } else {
      source.setData(
        pinnedLandmarksData(pinnedLandmarks) as Parameters<
          GeoJSONSource["setData"]
        >[0],
      );
    }
    // Beneath the observation, so the Bond's own marker stays on top of a
    // landmark it stands next to; above the fog marks, which list these first.
    const before = [
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
      OBSERVED_POSITION_ACCURACY_LAYER_ID,
      OBSERVED_POSITION_EDGE_LAYER_ID,
      OBSERVED_POSITION_POINT_LAYER_ID,
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of pinnedLandmarksLayers()) {
      if (mounted.getLayer(String(layer.id)) === undefined) {
        mounted.addLayer(layer as unknown as LayerSpecification, before);
      }
    }
    applyPinnedLandmarkLabels(mounted);
  }

  function stopOrbFall(): void {
    clearOrbFlights();
    if (orbFallFrame !== undefined) {
      globalThis.cancelAnimationFrame(orbFallFrame);
      orbFallFrame = undefined;
    }
    if (orbGlowTimer !== undefined) {
      globalThis.clearTimeout(orbGlowTimer);
      orbGlowTimer = undefined;
    }
  }

  function orbDrawOptions(): OrbDrawOptions {
    return { reducedMotion: prefersReducedMotion(globalThis.document) };
  }

  // Orbs move on every frame while some are falling or being picked up.
  // While they only lie and breathe their rarity's glow, a few frames a
  // second do; with reduced motion, or once none lies, nothing redraws them
  // until the list changes.
  function scheduleOrbs(now: number, options: OrbDrawOptions): void {
    if (orbFallFrame !== undefined || orbGlowTimer !== undefined) return;
    if (orbsFalling(orbs, now, options)) {
      orbFallFrame = globalThis.requestAnimationFrame(tickOrbFall);
    } else if (orbsGlowing(orbs, options)) {
      orbGlowTimer = globalThis.setTimeout(() => {
        orbGlowTimer = undefined;
        orbFallFrame = globalThis.requestAnimationFrame(tickOrbFall);
      }, ORB_GLOW_FRAME_MS);
    }
  }

  function clearOrbFlights(): void {
    orbFlightRoot?.remove();
    orbFlightRoot = undefined;
    orbFlights.clear();
  }

  function orbFlightBead(color: string, core: string, size: number) {
    const bead = globalThis.document.createElement("span");
    const px = Math.round(12 * size);
    bead.style.position = "absolute";
    bead.style.left = "0";
    bead.style.top = "0";
    bead.style.width = `${px}px`;
    bead.style.height = `${px}px`;
    bead.style.marginLeft = `${-px / 2}px`;
    bead.style.marginTop = `${-px / 2}px`;
    bead.style.boxSizing = "border-box";
    bead.style.borderRadius = "50%";
    bead.style.border = `1px solid ${color}`;
    bead.style.backgroundImage = `radial-gradient(circle at 35% 30%, #ffffff 0%, ${core} 45%, ${color} 100%)`;
    bead.style.boxShadow = `0 0 6px 2px ${color}, 0 0 18px 6px ${color}80`;
    bead.style.willChange = "transform, opacity";
    return bead;
  }

  function placeOrbFlightPart(element: HTMLElement, part?: FlightBead): void {
    if (part === undefined || part.opacity <= 0) {
      element.style.display = "none";
      return;
    }
    element.style.display = "block";
    element.style.opacity = String(Math.min(1, part.opacity));
    element.style.transform = `translate(${part.x}px, ${part.y}px) scale(${part.scale})`;
  }

  /**
   * Picked-up orbs fly over everything on the map, in screen pixels, from
   * where they lay into the picker's chest (`orb-flight.ts`).
   */
  function drawOrbFlights(
    mounted: MapLibreMap,
    now: number,
    options: OrbDrawOptions,
  ): void {
    const flying =
      options.reducedMotion === true
        ? []
        : orbs.filter(
            (orb) =>
              orb.kind === "orb" &&
              orb.pulledTo !== undefined &&
              now >= orb.pulledTo.at &&
              now < orb.pulledTo.at + ORB_COLLECT_MS,
          );
    for (const [id, flight] of orbFlights) {
      if (!flying.some((orb) => orb.id === id)) {
        flight.element.remove();
        orbFlights.delete(id);
      }
    }
    if (flying.length === 0) {
      clearOrbFlights();
      return;
    }
    if (orbFlightRoot === undefined) {
      orbFlightRoot = globalThis.document.createElement("div");
      orbFlightRoot.className = "map-orb-flights";
      orbFlightRoot.setAttribute("aria-hidden", "true");
      orbFlightRoot.style.position = "absolute";
      orbFlightRoot.style.inset = "0";
      orbFlightRoot.style.overflow = "hidden";
      orbFlightRoot.style.pointerEvents = "none";
      orbFlightRoot.style.zIndex = "5";
      mounted.getContainer().append(orbFlightRoot);
    }
    const zoom = mounted.getZoom();
    for (const orb of flying) {
      const to = orb.pulledTo!;
      let flight = orbFlights.get(orb.id);
      if (flight === undefined) {
        const color = orbColor(orb);
        const core = orbCoreColor(orb);
        const size = orbShineSize(orb);
        const element = globalThis.document.createElement("div");
        const bead = orbFlightBead(color, core, size);
        const trail = [0.8, 0.6, 0.4].map(() =>
          orbFlightBead(color, core, size),
        );
        const ring = globalThis.document.createElement("span");
        const ringPx = Math.round(30 * size);
        ring.style.position = "absolute";
        ring.style.left = "0";
        ring.style.top = "0";
        ring.style.width = `${ringPx}px`;
        ring.style.height = `${ringPx}px`;
        ring.style.marginLeft = `${-ringPx / 2}px`;
        ring.style.marginTop = `${-ringPx / 2}px`;
        ring.style.borderRadius = "50%";
        ring.style.border = `2px solid ${color}`;
        ring.style.backgroundColor = `${color}40`;
        ring.style.boxShadow = `0 0 14px 4px ${color}`;
        element.append(...trail, bead, ring);
        orbFlightRoot.append(element);
        flight = { element, bead, trail, ring };
        orbFlights.set(orb.id, flight);
      }
      const from = mounted.project([orb.longitude, orb.latitude]);
      const feet = mounted.project([to.longitude, to.latitude]);
      // Into the chest of a body standing there, however near the camera.
      const chest = Math.min(
        90,
        Math.max(
          16,
          (0.55 * MAP_BODY_HEIGHT_METERS) /
            mapMetersPerPixel(to.latitude, zoom),
        ),
      );
      const frame = orbFlightFrame(
        now - to.at,
        { x: from.x, y: from.y },
        { x: feet.x, y: feet.y - chest },
        orbSeed(orb.id) < 0.5 ? -1 : 1,
      );
      placeOrbFlightPart(flight.bead, frame?.bead);
      flight.trail.forEach((element, step) =>
        placeOrbFlightPart(element, frame?.trail[step]),
      );
      placeOrbFlightPart(flight.ring, frame?.ring);
    }
  }

  function tickOrbFall(): void {
    orbFallFrame = undefined;
    if (map === undefined) return;
    const now = Date.now();
    const options = orbDrawOptions();
    const source = map.getSource(ORBS_SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(
      orbsData(orbs, now, options) as Parameters<GeoJSONSource["setData"]>[0],
    );
    drawOrbFlights(map, now, options);
    scheduleOrbs(now, options);
  }

  function applyOrbs(mounted: MapLibreMap): void {
    if (orbs.length === 0) {
      stopOrbFall();
      for (const layerId of [
        ORBS_AURA_LAYER_ID,
        ORBS_GLOW_LAYER_ID,
        ORBS_CORE_LAYER_ID,
        ORBS_GOAL_LAYER_ID,
      ]) {
        if (mounted.getLayer(layerId) !== undefined)
          mounted.removeLayer(layerId);
      }
      if (mounted.getSource(ORBS_SOURCE_ID) !== undefined) {
        mounted.removeSource(ORBS_SOURCE_ID);
      }
      return;
    }
    const now = Date.now();
    const options = orbDrawOptions();
    const source = mounted.getSource(ORBS_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) {
      mounted.addSource(
        ORBS_SOURCE_ID,
        orbsSource(orbs, now, options) as unknown as SourceSpecification,
      );
    } else {
      source.setData(
        orbsData(orbs, now, options) as Parameters<GeoJSONSource["setData"]>[0],
      );
    }
    // Beneath the observation and the pins, like the fog marks: an orb lies
    // on the ground the Bond's own marker stands on.
    const before = [
      PINNED_LANDMARKS_GLOW_LAYER_ID,
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of orbsLayers()) {
      if (mounted.getLayer(String(layer.id)) === undefined) {
        mounted.addLayer(layer as unknown as LayerSpecification, before);
      }
    }
    drawOrbFlights(mounted, now, options);
    // A picked-up orb must start moving now, not after a glow frame.
    if (orbGlowTimer !== undefined && orbsFalling(orbs, now, options)) {
      globalThis.clearTimeout(orbGlowTimer);
      orbGlowTimer = undefined;
    }
    scheduleOrbs(now, options);
  }

  function applyRoute(mounted: MapLibreMap): void {
    if (route === null) {
      for (const layerId of [ROUTE_LINE_LAYER_ID, ROUTE_CASING_LAYER_ID]) {
        if (mounted.getLayer(layerId) !== undefined)
          mounted.removeLayer(layerId);
      }
      if (mounted.getSource(ROUTE_SOURCE_ID) !== undefined) {
        mounted.removeSource(ROUTE_SOURCE_ID);
      }
      return;
    }
    const source = mounted.getSource(ROUTE_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) {
      mounted.addSource(
        ROUTE_SOURCE_ID,
        routeSource(route) as unknown as SourceSpecification,
      );
    } else {
      source.setData(
        routeData(route) as Parameters<GeoJSONSource["setData"]>[0],
      );
    }
    // Over the ground and the roofs it crosses, beneath the pins and the
    // Bond's own marker.
    const before = [
      ORBS_AURA_LAYER_ID,
      PINNED_LANDMARKS_GLOW_LAYER_ID,
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of routeLayers()) {
      if (mounted.getLayer(String(layer.id)) === undefined) {
        mounted.addLayer(layer as unknown as LayerSpecification, before);
      }
    }
  }

  /**
   * The bridges' decks and piers, standing with the buildings: beneath their
   * extrusion in the layer order, above every flat layer and road.
   */
  function applyBridgeStructures(mounted: MapLibreMap): void {
    // Nothing is added to a map until it has a bridge to show.
    if (bridgeData.features.length === 0) return;
    if (mounted.getSource(BRIDGE_STRUCTURE_SOURCE_ID) === undefined) {
      mounted.addSource(BRIDGE_STRUCTURE_SOURCE_ID, {
        type: "geojson",
        data: bridgeData,
      } as unknown as SourceSpecification);
    }
    // Beneath the building extrusion, or the first of what draws above it.
    const before = [
      BUILDING_EXTRUSION_LAYER_ID,
      "boundaries",
      "pois",
      "water-labels",
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of bridgeStructureLayers(BRIDGE_PALETTES[appearance])) {
      if (mounted.getLayer(String(layer.id)) !== undefined) continue;
      mounted.addLayer(
        {
          ...layer,
          layout: { visibility: dimension === "flat" ? "none" : "visible" },
        } as unknown as LayerSpecification,
        before,
      );
    }
  }

  /** Builds the bridges again from the roads the view has loaded. */
  function refreshBridgeStructures(mounted: MapLibreMap): void {
    if (mounted.getZoom() < BRIDGE_STRUCTURE_MIN_ZOOM - 0.5) return;
    const next = bridgeStructures(loadedRoads(mounted, () => true));
    let fingerprint = String(next.features.length);
    for (const feature of next.features) {
      const [longitude, latitude] = feature.geometry.coordinates[0]![0]!;
      fingerprint += `|${longitude.toFixed(6)},${latitude.toFixed(6)},${feature.properties.top.toFixed(1)}`;
    }
    if (fingerprint === bridgeFingerprint) return;
    bridgeFingerprint = fingerprint;
    bridgeData = next;
    const source = mounted.getSource(BRIDGE_STRUCTURE_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) applyBridgeStructures(mounted);
    else source.setData(bridgeData as Parameters<GeoJSONSource["setData"]>[0]);
  }

  /**
   * The roads in the tiles the view has loaded whose lines `keep` takes. The
   * same street arrives once per tile it crosses; callers join the copies.
   */
  function loadedRoads(
    mounted: MapLibreMap,
    keep: (line: readonly (readonly [number, number])[]) => boolean,
  ): MapRoad[] {
    const sourceId = mounted.getLayer(ROAD_SOURCE_LAYER)?.source ?? "basemap";
    if (mounted.getSource(sourceId) === undefined) return [];
    const roads: MapRoad[] = [];
    for (const feature of mounted.querySourceFeatures(sourceId, {
      sourceLayer: ROAD_SOURCE_LAYER,
    })) {
      const kind = feature.properties?.["kind"];
      if (typeof kind !== "string") continue;
      const geometry = feature.geometry as {
        readonly type: string;
        readonly coordinates: unknown;
      };
      const lines = (
        geometry.type === "LineString"
          ? [geometry.coordinates as [number, number][]]
          : geometry.type === "MultiLineString"
            ? (geometry.coordinates as [number, number][][])
            : []
      ).filter((line) => line.length >= 2 && keep(line));
      if (lines.length === 0) continue;
      const detail = feature.properties?.["kind_detail"];
      roads.push({
        kind,
        ...(typeof detail === "string" ? { kindDetail: detail } : {}),
        ...(feature.properties?.["is_bridge"] === true
          ? { isBridge: true }
          : {}),
        lines,
      });
    }
    return roads;
  }

  function ensureAvatarLayer(mounted: MapLibreMap): void {
    if (avatarLayer === undefined) return;
    if (mounted.getLayer(avatarLayer.id) !== undefined) return;
    mounted.addLayer(avatarLayer);
  }

  function ensureMonumentLayer(mounted: MapLibreMap): void {
    if (monumentLayer === undefined) return;
    if (mounted.getLayer(monumentLayer.id) !== undefined) return;
    mounted.addLayer(monumentLayer);
  }

  /**
   * Once the Motherland model stands, the basemap's own blocky statue gives
   * way to it: cut out of the extrusion, never out of the flat footprints. A
   * style swap brings back the style's own filter, and the model reloading
   * into the new style brings the cut-out back with it.
   */
  function applyMonumentCutout(mounted: MapLibreMap): void {
    if (monumentLayer?.hasModel() !== true) return;
    if (mounted.getLayer(BUILDING_EXTRUSION_LAYER_ID) === undefined) return;
    const filter = extrusionFilter(mounted);
    if (carriesMotherlandCutout(filter)) return;
    mounted.setFilter(BUILDING_EXTRUSION_LAYER_ID, withoutMotherland(filter));
  }

  function extrusionFilter(
    mounted: MapLibreMap,
  ): FilterSpecification | null | undefined {
    return (
      mounted.getLayer(BUILDING_EXTRUSION_LAYER_ID) as
        { readonly filter?: FilterSpecification | null } | undefined
    )?.filter;
  }

  /**
   * The model's plinth, standing in as an obstacle for the drum the cut-out
   * took away — only while the cut-out is in place, so the statue is solid
   * exactly once, as whichever of the two is drawn.
   */
  function monumentObstacle(
    mounted: MapLibreMap,
    bounds: MapBounds,
  ): MapObstacle | undefined {
    if (!carriesMotherlandCutout(extrusionFilter(mounted))) return undefined;
    const ring = motherlandPedestalRing();
    if (!ringTouches(ring, bounds)) return undefined;
    return {
      kind: "building",
      polygons: [[ring]],
      heights: [MOTHERLAND_PEDESTAL_HEIGHT_METERS],
    };
  }

  function applyPresentation(mounted: MapLibreMap): void {
    applyBridgeStructures(mounted);
    applyDimension(mounted);
    applyMotherlandTerraces(mounted);
    applyFogMarks(mounted);
    applyRoute(mounted);
    applyOrbs(mounted);
    applyPinnedLandmarks(mounted);
    applyObservedPosition(mounted);
    applySelectionPoint(mounted);
    if (firstPaintDone && avatarLayer?.hasInstances())
      ensureAvatarLayer(mounted);
    if (firstPaintDone) {
      ensureVegetationLayer(mounted);
      ensureMonumentLayer(mounted);
      applyMonumentCutout(mounted);
      void requestMonumentLayer().catch(ignoreOptionalLayer);
    }
    presentationApplied = true;
  }

  function existingLayers(
    mounted: MapLibreMap,
    ids: readonly string[],
  ): string[] {
    return ids.filter((id) => mounted.getLayer(id) !== undefined);
  }

  /**
   * What is painted under a tap. Fog outranks what is drawn beneath it: ground
   * this device has not revealed is not somewhere a body walks, whatever the
   * basemap shows there.
   */
  function groundAt(
    mounted: MapLibreMap,
    point: MapScreenPoint,
    selected: MapPointSelection,
  ): MapGround {
    if (isGroundRevealed?.(selected) === false) return "fog";
    const query = (layers: readonly string[]): boolean => {
      const present = existingLayers(mounted, layers);
      if (present.length === 0) return false;
      return (
        mounted.queryRenderedFeatures([point.x, point.y], { layers: present })
          .length > 0
      );
    };
    if (query(BUILDING_LAYER_IDS)) return "building";
    if (query(WATER_LAYER_IDS)) return "water";
    return "open";
  }

  /**
   * The polygons one style layer paints that touch a box, read from the tiles
   * it already has. The layer's own filter is what decides membership, so an
   * obstacle is exactly what the person sees drawn as one.
   */
  function polygonsPainted(
    mounted: MapLibreMap,
    layerId: string,
    bounds: MapBounds,
  ): Pick<MapObstacle, "polygons"> & {
    readonly heights: readonly number[];
    readonly bases: readonly number[];
  } {
    const layer = mounted.getLayer(layerId) as
      | {
          readonly source?: string;
          readonly sourceLayer?: string;
          readonly filter?: FilterSpecification | null;
        }
      | undefined;
    if (layer?.source === undefined || layer.sourceLayer === undefined) {
      return { polygons: [], heights: [], bases: [] };
    }
    if (mounted.getSource(layer.source) === undefined) {
      return { polygons: [], heights: [], bases: [] };
    }
    const polygons: (readonly (readonly [number, number])[])[][] = [];
    const heights: number[] = [];
    const bases: number[] = [];
    for (const feature of mounted.querySourceFeatures(layer.source, {
      sourceLayer: layer.sourceLayer,
      ...(layer.filter == null ? {} : { filter: layer.filter }),
    })) {
      const geometry = feature.geometry as {
        readonly type: string;
        readonly coordinates: unknown;
      };
      const raised = Number(feature.properties?.["height"]);
      const height =
        Number.isFinite(raised) && raised > 0
          ? raised
          : BUILDING_DEFAULT_HEIGHT_METERS;
      const lifted = Number(feature.properties?.["min_height"]);
      const base = Number.isFinite(lifted) && lifted > 0 ? lifted : 0;
      const parts =
        geometry.type === "Polygon"
          ? [geometry.coordinates as [number, number][][]]
          : geometry.type === "MultiPolygon"
            ? (geometry.coordinates as [number, number][][][])
            : [];
      for (const rings of parts) {
        const outer = rings[0];
        if (outer === undefined || !ringTouches(outer, bounds)) continue;
        polygons.push(rings);
        heights.push(height);
        bases.push(base);
      }
    }
    return { polygons, heights, bases };
  }

  function landmarkFrom(
    feature: {
      readonly id?: string | number | undefined;
      readonly geometry: { readonly type: string };
      readonly properties: Record<string, unknown> | null;
    },
    kinds?: ReadonlySet<string>,
  ): MapLandmark | undefined {
    if (feature.geometry.type !== "Point") return undefined;
    const [longitude, latitude] = (
      feature.geometry as unknown as { coordinates: [number, number] }
    ).coordinates;
    return landmarkFromPoint({
      id: feature.id,
      properties: feature.properties ?? {},
      longitude,
      latitude,
      ...(kinds === undefined ? {} : { kinds }),
    });
  }

  /**
   * The features of one source layer in the tiles the view has loaded. One
   * outing asks for landmarks and then areas in the same turn, so what was
   * read is kept until the turn ends and each layer is queried once.
   */
  let viewFeaturesHeld: Map<string, readonly ViewFeature[]> | undefined;
  function viewFeatures(layer: string): readonly ViewFeature[] {
    if (map === undefined) return [];
    let held = viewFeaturesHeld;
    if (held === undefined) {
      const fresh = new Map<string, readonly ViewFeature[]>();
      held = viewFeaturesHeld = fresh;
      queueMicrotask(() => {
        if (viewFeaturesHeld === fresh) viewFeaturesHeld = undefined;
      });
    }
    let features = held.get(layer);
    if (features === undefined) {
      const sourceId = map.getLayer(layer)?.source ?? "basemap";
      features =
        map.getSource(sourceId) === undefined
          ? []
          : map.querySourceFeatures(sourceId, { sourceLayer: layer });
      held.set(layer, features);
    }
    return features;
  }

  /** The labels and polygon parts of areas in the tiles the view has loaded. */
  function viewAreaSources(): AreaSources {
    const labels = (features: readonly ViewFeature[]) =>
      features.flatMap((feature) => {
        if (feature.geometry.type !== "Point") return [];
        const label = areaLabelOf({
          id: feature.id,
          properties: feature.properties ?? {},
          point: (
            feature.geometry as unknown as { coordinates: [number, number] }
          ).coordinates,
        });
        return label === undefined ? [] : [label];
      });
    const parts = (
      layer: typeof LANDUSE_SOURCE_LAYER | typeof WATER_SOURCE_LAYER,
      features: readonly ViewFeature[],
    ) =>
      features.flatMap((feature) => {
        const geometry = feature.geometry as {
          readonly type: string;
          readonly coordinates: unknown;
        };
        const polygons =
          geometry.type === "Polygon"
            ? [geometry.coordinates as [number, number][][]]
            : geometry.type === "MultiPolygon"
              ? (geometry.coordinates as [number, number][][][])
              : [];
        if (polygons.length === 0) return [];
        // The tile the view read the feature from, to cut its piece back to.
        const { _z: z, _x: x, _y: y } = feature as Partial<ViewFeature>;
        const part = areaPartOf(layer, {
          id: feature.id,
          properties: feature.properties ?? {},
          polygons,
          ...(z === undefined || x === undefined || y === undefined
            ? {}
            : { tile: { z, x, y } }),
        });
        return part === undefined ? [] : [part];
      });
    const water = viewFeatures(WATER_SOURCE_LAYER);
    return {
      poiLabels: labels(viewFeatures(POI_SOURCE_LAYER)),
      landuse: parts(LANDUSE_SOURCE_LAYER, viewFeatures(LANDUSE_SOURCE_LAYER)),
      waterLabels: labels(water),
      water: parts(WATER_SOURCE_LAYER, water),
    };
  }

  function releaseLabel(): void {
    labelMarker?.remove();
    labelMarker = undefined;
    labelElement = undefined;
    labelBody?.dispose();
    labelBody = undefined;
    labelBodyRequested = false;
    labelBodyReady = false;
  }

  function releaseSelectionMarker(): void {
    selectionMarker?.remove();
    selectionMarker = undefined;
  }

  function releaseTapFeedback(entry: TapFeedbackEntry): void {
    if (entry.fadeTimer !== undefined) {
      globalThis.clearTimeout(entry.fadeTimer);
    }
    if (entry.removeTimer !== undefined) {
      globalThis.clearTimeout(entry.removeTimer);
    }
    entry.marker.remove();
    const index = tapFeedbackEntries.indexOf(entry);
    if (index !== -1) tapFeedbackEntries.splice(index, 1);
  }

  function fadeTapFeedback(entry: TapFeedbackEntry): void {
    if (entry.fadeTimer !== undefined) {
      globalThis.clearTimeout(entry.fadeTimer);
    }
    if (entry.element.style.opacity === "0") return;
    entry.element.style.opacity = "0";
    if (entry.removeTimer !== undefined) {
      globalThis.clearTimeout(entry.removeTimer);
    }
    // A second tap accelerates the previous fade, but can never extend the
    // original three-second lifetime.
    const now = globalThis.performance.now();
    const remaining = Math.max(0, entry.expiresAt - now);
    entry.removeTimer = globalThis.setTimeout(
      () => releaseTapFeedback(entry),
      Math.min(TAP_FEEDBACK_FADE_MS, remaining),
    );
  }

  function clearTapFeedback(): void {
    for (const entry of [...tapFeedbackEntries]) releaseTapFeedback(entry);
  }

  return {
    avatars,
    systemDrone,
    animals,

    mount(container) {
      if (map !== undefined) {
        return;
      }

      publish({ kind: "loading" });

      try {
        ensureWorkerUrl();
        ensurePmtilesProtocol();
        const mountedMap = createMap({
          container,
          style: styleUrls[appearance],
          center: [...camera.center],
          zoom: camera.zoom,
          bearing: camera.bearing,
          pitch: camera.pitch,
        });
        map = mountedMap;
        if (zoomPivot !== "pointer") applyZoomPivot(mountedMap);
        // Telegram can resize the WebView without a window resize event.
        // Coalesce host changes into a single canvas update each frame.
        let resizeFrame: number | undefined;
        const syncViewport = () => {
          resizeFrame = undefined;
          if (map !== mountedMap || !container.isConnected) return;
          const bounds = container.getBoundingClientRect();
          if (bounds.width <= 0 || bounds.height <= 0) return;
          mountedMap.resize();
          if (styleReadyForPaint) completeFirstPaint(mountedMap, container);
        };
        const scheduleViewportSync = () => {
          if (map !== mountedMap || resizeFrame !== undefined) return;
          resizeFrame = globalThis.requestAnimationFrame(syncViewport);
        };
        const observer =
          typeof ResizeObserver === "undefined"
            ? undefined
            : new ResizeObserver(scheduleViewportSync);
        observer?.observe(container);
        const onVisible = () => {
          if (document.visibilityState === "visible") scheduleViewportSync();
        };
        globalThis.addEventListener("resize", scheduleViewportSync);
        globalThis.visualViewport?.addEventListener(
          "resize",
          scheduleViewportSync,
        );
        globalThis.addEventListener("pageshow", scheduleViewportSync);
        document.addEventListener("visibilitychange", onVisible);
        scheduleViewportSync();
        // MapLibre cancels any gesture it is recognising whenever the camera
        // is set, so a background move has to know a person is pressing the
        // map before MapLibre has decided that the press is a gesture. A
        // release is heard on the window, wherever the pointer ended up.
        const press = (event: PointerEvent) => {
          pressedPointers.add(event.pointerId);
        };
        const release = (event: PointerEvent) => {
          pressedPointers.delete(event.pointerId);
        };
        const releaseAll = () => pressedPointers.clear();
        container.addEventListener("pointerdown", press, true);
        globalThis.addEventListener("pointerup", release, true);
        globalThis.addEventListener("pointercancel", release, true);
        globalThis.addEventListener("blur", releaseAll);
        viewportCleanup = () => {
          container.removeEventListener("pointerdown", press, true);
          globalThis.removeEventListener("pointerup", release, true);
          globalThis.removeEventListener("pointercancel", release, true);
          globalThis.removeEventListener("blur", releaseAll);
          pressedPointers.clear();
          observer?.disconnect();
          globalThis.removeEventListener("resize", scheduleViewportSync);
          globalThis.visualViewport?.removeEventListener(
            "resize",
            scheduleViewportSync,
          );
          globalThis.removeEventListener("pageshow", scheduleViewportSync);
          document.removeEventListener("visibilitychange", onVisible);
          if (resizeFrame !== undefined) {
            globalThis.cancelAnimationFrame(resizeFrame);
            resizeFrame = undefined;
          }
        };
        styleResolved = false;
        styleReadyForPaint = false;
        firstPaintDone = false;
        presentationApplied = false;

        // A timeout still has to say which phase never finished: a style
        // document that never resolved is a publication problem, while a
        // resolved style with no first frame is the tile pipeline — the worker,
        // the basemap archive, or the paint itself.
        loadTimer = globalThis.setTimeout(() => {
          if (status.kind === "loading") {
            publish({
              kind: "unavailable",
              reason: styleResolved
                ? "first-paint-timeout"
                : "style-load-timeout",
            });
          }
        }, loadTimeoutMs);

        const canvas = mountedMap.getCanvas?.();
        canvas?.addEventListener("webglcontextlost", () => {
          publish({ kind: "unavailable", reason: "webgl-context-lost" });
        });

        // Render can arrive before MapLibre load when the basemap is already
        // visible but a tile or fog source is still pending.
        mountedMap.on("style.load", () => {
          styleResolved = true;
          styleReadyForPaint = true;
        });
        mountedMap.on("render", () => {
          if (styleReadyForPaint) completeFirstPaint(mountedMap, container);
        });
        mountedMap.on("styledata", () => {
          styleResolved = true;
          // A reloaded style arrives without the renderer's own presentation
          // layers, so they are restored here rather than on a timer.
          if (!presentationApplied) {
            applyPresentation(mountedMap);
          }
        });
        mountedMap.on("error", (event) => {
          reportRendererError(event.error);
        });
        // Claim camera ownership as soon as a user gesture begins, not after
        // it finishes and could be overwritten by an opening flight.
        mountedMap.on("movestart", (event: { originalEvent?: unknown }) => {
          if (event?.originalEvent !== undefined) {
            publishCamera(true, "start", event.originalEvent);
          }
        });
        // moveend rather than move: final camera state is published once per
        // gesture instead of every animation frame.
        mountedMap.on("moveend", (event: { originalEvent?: unknown }) => {
          publishCamera(
            event?.originalEvent !== undefined,
            "end",
            event?.originalEvent,
          );
        });
        // "idle" is MapLibre saying every tile the view needs has loaded and
        // painted: the one moment new landmarks can have become readable. It
        // fires once per settle, not once per tile.
        mountedMap.on("idle", () => {
          try {
            refreshBridgeStructures(mountedMap);
          } catch {
            // Bridges are presentation over the map; they never break it.
          }
          try {
            updateVegetation(mountedMap);
          } catch {
            // Trees are presentation over the map; they never break it.
          }
          for (const listener of [...landmarkListeners]) listener();
        });
        mountedMap.on("zoom", () => {
          updateLabelVisibility(mountedMap);
          updatePinnedLabelVisibility(mountedMap);
        });
        // Pitch and bearing move cards relative to each other without a zoom,
        // so which ones collide is settled again once the camera stops.
        mountedMap.on("moveend", () => {
          updatePinnedLabelVisibility(mountedMap);
        });
        // Point-selection mode consumes the tap before ordinary world actions.
        // That keeps an editor gesture from also activating a body underneath.
        mountedMap.on(
          "click",
          (event: {
            point?: MapScreenPoint;
            lngLat?: { lng: number; lat: number };
          }) => {
            if (pointSelectionListeners.size > 0) {
              const selected = event?.lngLat;
              if (selected !== undefined) {
                const point: MapPointSelection = {
                  longitude: selected.lng,
                  latitude: selected.lat,
                };
                if (validPoint(point)) {
                  for (const listener of [...pointSelectionListeners]) {
                    listener({ ...point });
                  }
                }
              }
              return;
            }

            const point = event?.point;
            if (point === undefined) return;
            if (droneActivationListeners.size && avatarLayer !== undefined) {
              const hit = [...droneHandles.values()].find((handle) => {
                if (!droneActivationListeners.has(handle.id)) return false;
                const screen = mountedMap.project(
                  handle.lngLat as [number, number],
                );
                const altitude =
                  (handle.heightMeters ?? 1.9) /
                  mapMetersPerPixel(handle.lngLat[1], mountedMap.getZoom());
                return (
                  Math.hypot(
                    point.x - screen.x,
                    point.y -
                      (screen.y -
                        altitude *
                          Math.sin((mountedMap.getPitch() * Math.PI) / 180)),
                  ) < 24
                );
              });
              if (hit) {
                for (const listener of [
                  ...(droneActivationListeners.get(hit.id) ?? []),
                ])
                  listener();
                return;
              }
            }
            const id = bodyAtPoint(drawnBodies(mountedMap), point);
            if (id !== undefined) {
              for (const listener of [...bodyActivationListeners]) {
                listener({ id });
              }
              return;
            }

            const selected = event?.lngLat;
            if (selected === undefined || groundTapListeners.size === 0) {
              return;
            }
            const at: MapPointSelection = {
              longitude: selected.lng,
              latitude: selected.lat,
            };
            if (!validPoint(at)) return;
            const ground = groundAt(mountedMap, point, at);
            for (const listener of [...groundTapListeners]) {
              listener({ ...at, ground });
            }
          },
        );
        // Keep MapLibre load as a compatibility fallback.
        mountedMap.once("load", () => {
          styleResolved = true;
          styleReadyForPaint = true;
          completeFirstPaint(mountedMap, container);
        });
      } catch {
        map = undefined;
        publish({ kind: "unavailable", reason: "renderer-init-failed" });
      }
    },

    unmount() {
      viewportCleanup?.();
      viewportCleanup = undefined;
      stopFogPulse();
      stopOrbFall();
      releaseLabel();
      releaseSelectionMarker();
      clearTapFeedback();
      releasePinnedLabels();
      vegetationPlanted = [];
      vegetationKey = "";
      vegetationLayer?.setInstances([]);
      map?.remove();
      map = undefined;
      styleResolved = false;
      styleReadyForPaint = false;
      firstPaintDone = false;
      presentationApplied = false;
      publish({ kind: "unmounted" });
    },

    whenSceneReady(signal) {
      const mounted = map;
      if (mounted === undefined)
        return Promise.reject(new Error("Map is not mounted"));
      return waitForScene(
        mounted,
        () =>
          firstPaintDone &&
          presentationApplied &&
          (dimension === "flat" ||
            monumentLayerFailed ||
            monumentLayer?.isSettled() === true) &&
          (avatarHandles.size === 0 ||
            avatarLayerFailed ||
            avatarLayer?.assetsSettled() === true),
        signal,
      );
    },

    getStatus() {
      return status;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getCamera() {
      return camera;
    },

    getCameraPadding() {
      const padding = map?.getPadding();
      return {
        top: padding?.top ?? 0,
        right: padding?.right ?? 0,
        bottom: padding?.bottom ?? 0,
        left: padding?.left ?? 0,
      };
    },

    subscribeCamera(listener) {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },

    subscribeBodyActivation(listener) {
      bodyActivationListeners.add(listener);
      return () => bodyActivationListeners.delete(listener);
    },

    subscribeGroundTap(listener) {
      groundTapListeners.add(listener);
      return () => groundTapListeners.delete(listener);
    },

    showGroundTapFeedback(point, seat) {
      if (map === undefined || !validPoint(point)) return;

      // At most one current mark and one outgoing mark. Faster repeated taps
      // never accumulate markers or leave their timers behind.
      for (const entry of [...tapFeedbackEntries]) fadeTapFeedback(entry);
      while (tapFeedbackEntries.length >= 2) {
        releaseTapFeedback(tapFeedbackEntries[0]!);
      }

      const element = tapFeedbackElement(seat);
      const marker = createTapFeedbackMarker(map, element, [
        point.longitude,
        point.latitude,
      ]);
      const entry: TapFeedbackEntry = {
        marker,
        element,
        expiresAt: globalThis.performance.now() + TAP_FEEDBACK_LIFETIME_MS,
      };
      tapFeedbackEntries.push(entry);
      entry.fadeTimer = globalThis.setTimeout(
        () => fadeTapFeedback(entry),
        TAP_FEEDBACK_LIFETIME_MS - TAP_FEEDBACK_FADE_MS,
      );
      entry.removeTimer = globalThis.setTimeout(
        () => releaseTapFeedback(entry),
        TAP_FEEDBACK_LIFETIME_MS,
      );
    },

    landmarksNear(point, radiusMeters) {
      if (!validPoint(point)) return [];
      const found = new Map<
        string,
        { landmark: MapLandmark; distance: number }
      >();
      const add = (landmark: MapLandmark | undefined) => {
        if (landmark === undefined || found.has(landmark.id)) return;
        const distance = mapDistanceMeters(point, landmark);
        if (distance <= radiusMeters)
          found.set(landmark.id, { landmark, distance });
      };
      // What was read ahead for an outing, beside what the view has loaded.
      // One feature in both has one archive id and is counted once.
      for (const landmark of landmarkTiles.landmarksNear(point, radiusMeters)) {
        add(landmark);
      }
      for (const feature of viewFeatures(POI_SOURCE_LAYER)) {
        add(landmarkFrom(feature));
      }
      return [...found.values()]
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.landmark);
    },

    pointsNear(point, radiusMeters, kinds) {
      if (!validPoint(point)) return [];
      const found = new Map<string, { point: MapLandmark; distance: number }>();
      for (const feature of viewFeatures(POI_SOURCE_LAYER)) {
        const candidate = landmarkFrom(feature, kinds);
        if (candidate === undefined || found.has(candidate.id)) continue;
        const distance = mapDistanceMeters(point, candidate);
        if (distance <= radiusMeters) {
          found.set(candidate.id, { point: candidate, distance });
        }
      }
      return [...found.values()]
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.point);
    },

    areasNear(point, radiusMeters) {
      if (!validPoint(point)) return [];
      const readAhead = landmarkTiles.areaSourcesNear(point, radiusMeters);
      const fromView = viewAreaSources();
      // A tile both hold is read once, from the tiles read ahead: the view's
      // copy is the same ground, decoded with other rounding.
      const tileKey = ({ tile }: AreaPart) =>
        tile === undefined ? undefined : `${tile.z}/${tile.x}/${tile.y}`;
      const held = new Set(
        [...readAhead.landuse, ...readAhead.water].map(tileKey),
      );
      const fresh = (part: AreaPart) => {
        const key = tileKey(part);
        return key === undefined || !held.has(key);
      };
      // Only labels in reach are joined; their parts may lie anywhere.
      const near = (label: AreaLabel) =>
        mapDistanceMeters(point, {
          longitude: label.point[0],
          latitude: label.point[1],
        }) <= radiusMeters;
      const sources = mergeAreaSources([
        readAhead,
        {
          ...fromView,
          landuse: fromView.landuse.filter(fresh),
          water: fromView.water.filter(fresh),
        },
      ]);
      const areas = joinAreas({
        ...sources,
        poiLabels: sources.poiLabels.filter(near),
        waterLabels: sources.waterLabels.filter(near),
      });
      return areas
        .map((area) => ({
          area,
          distance: mapDistanceMeters(point, area.label),
        }))
        .filter(({ distance }) => distance <= radiusMeters)
        .sort((a, b) => a.distance - b.distance)
        .map(({ area }) => area);
    },

    obstaclesWithin(bounds) {
      if (map === undefined) return [];
      const mounted = map;
      const obstacles: MapObstacle[] = [];
      const collect = (
        kind: MapObstacle["kind"],
        layerIds: readonly string[],
      ): void => {
        // The flat and the raised building layers paint the same footprints;
        // one of them is enough.
        for (const layerId of existingLayers(mounted, layerIds)) {
          const { polygons, heights, bases } = polygonsPainted(
            mounted,
            layerId,
            bounds,
          );
          if (polygons.length === 0) continue;
          obstacles.push(
            kind === "building"
              ? { kind, polygons, heights, bases }
              : { kind, polygons },
          );
          return;
        }
      };
      collect("building", BUILDING_LAYER_IDS);
      // The terraces left the generic extrusion for a layer of their own;
      // they are just as solid, and just as walkable, as before.
      if (mounted.getLayer(MOTHERLAND_TERRACE_LAYER_ID) !== undefined) {
        const { polygons, heights, bases } = polygonsPainted(
          mounted,
          MOTHERLAND_TERRACE_LAYER_ID,
          bounds,
        );
        if (polygons.length > 0) {
          obstacles.push({ kind: "building", polygons, heights, bases });
        }
      }
      const monument = monumentObstacle(mounted, bounds);
      if (monument !== undefined) obstacles.push(monument);
      collect("water", WATER_LAYER_IDS);
      return obstacles;
    },

    greenAreasWithin(bounds) {
      return greenAreasIn(bounds);
    },

    roadsWithin(bounds) {
      // What the view has loaded, and what was read ahead for a walk. A street
      // in both arrives twice; the walking graph joins the copies.
      const preloaded = roadTiles.roadsWithin(bounds);
      if (map === undefined) return preloaded;
      return [
        ...preloaded,
        ...loadedRoads(map, (line) => ringTouches(line, bounds)),
      ];
    },

    preloadRoads(bounds, accept) {
      return roadTiles.preload(bounds, accept);
    },

    preloadLandmarks(bounds, accept) {
      return landmarkTiles.preload(bounds, accept);
    },

    subscribeLandmarksChanged(listener) {
      landmarkListeners.add(listener);
      return () => landmarkListeners.delete(listener);
    },

    subscribePointSelection(listener) {
      pointSelectionListeners.add(listener);
      return () => pointSelectionListeners.delete(listener);
    },

    setCamera(next: MapCamera, cameraOptions: MapCameraOptions = {}) {
      if (cameraOptions.yieldToGesture === true && pressedPointers.size > 0) {
        return;
      }
      camera = next;
      avatars.setCamera(next);

      const target = {
        center: [...next.center] as [number, number],
        zoom: next.zoom,
        bearing: next.bearing,
        pitch: next.pitch,
        ...(cameraOptions.padding === undefined
          ? {}
          : { padding: { ...cameraOptions.padding } }),
      };

      // MapLibre owns the transition mechanics; the application only says
      // whether this change should read as movement or as an immediate cut.
      if (cameraOptions.motion === "eased") {
        map?.easeTo({
          ...target,
          duration: cameraOptions.durationMs ?? MAP_CAMERA_TRANSITION_MS,
        });
        return;
      }
      if (cameraOptions.motion === "flight") {
        map?.flyTo({
          ...target,
          duration: cameraOptions.durationMs ?? MAP_OPENING_FLIGHT_MS,
        });
        return;
      }

      map?.jumpTo(target);
    },

    setZoomPivot(next: MapZoomPivot) {
      if (next === zoomPivot) return;
      zoomPivot = next;
      if (map !== undefined) applyZoomPivot(map);
    },

    setAppearance(next: MapAppearance) {
      if (next === appearance) {
        return;
      }

      appearance = next;
      monumentLayer?.setAppearance(next);

      if (map === undefined) {
        return;
      }

      // A style swap keeps the current camera and reopens the style phase so a
      // missing appearance variant is reported instead of blanking the map.
      styleResolved = false;
      styleReadyForPaint = false;
      presentationApplied = false;
      // MapLibre owns style diffing, but the renderer owns live terrain state.
      // Detach it before replacing the style so an in-flight presentation
      // change cannot rebind the outgoing style's DEM source.
      map.setTerrain(null);
      map.setStyle(styleUrls[next]);
    },

    setDimension(next: MapDimension) {
      if (next === dimension) {
        return;
      }

      dimension = next;

      if (map !== undefined && presentationApplied) {
        applyDimension(map);
      }
    },

    setObservedPosition(next: MapObservedPosition | null) {
      observedPosition = next;

      if (map !== undefined && presentationApplied) {
        applyObservedPosition(map);
      }
    },

    setObservedPositionLabel(next: MapObservedPositionLabel | null) {
      observedLabel = next;

      if (map !== undefined && presentationApplied) {
        applyLabel(map);
      }
    },

    setSelectionPoint(next: MapPointSelection | null) {
      selectionPoint = next === null ? null : { ...next };
      if (map !== undefined) applySelectionPoint(map);
    },

    ...(options.fog === undefined ? {} : { fog: options.fog }),

    setFogMarks(next: readonly MapFogMark[]) {
      fogMarks = [...next];
      if (map !== undefined && presentationApplied) applyFogMarks(map);
    },

    setPinnedLandmarks(next: readonly MapPinnedLandmark[]) {
      pinnedLandmarks = next.map((landmark) => ({ ...landmark }));
      if (map !== undefined && presentationApplied) applyPinnedLandmarks(map);
    },

    setFlightLoot(next: readonly MapFlightLoot[]) {
      flightLootHandles = next.map((item) => ({ ...item }));
      if (avatarLayer !== undefined)
        avatarLayer.setFlightLoot(flightLootHandles);
      else if (flightLootHandles.length > 0)
        void requestAvatarLayer().catch(ignoreOptionalLayer);
    },

    setOrbs(next: readonly MapOrb[]) {
      orbs = next.map((orb) => ({ ...orb }));
      if (map !== undefined && presentationApplied) applyOrbs(map);
    },

    setRoute(next: MapRoute | null) {
      route =
        next === null
          ? null
          : { points: next.points.map(([lng, lat]) => [lng, lat] as const) };
      if (map !== undefined && presentationApplied) applyRoute(map);
    },
  };
}

function ringTouches(
  ring: readonly (readonly [number, number])[],
  bounds: MapBounds,
): boolean {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [longitude, latitude] of ring) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  return (
    west <= bounds.east &&
    east >= bounds.west &&
    south <= bounds.north &&
    north >= bounds.south
  );
}
