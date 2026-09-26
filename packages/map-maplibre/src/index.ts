// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_MAP_APPEARANCE,
  DEFAULT_MAP_DIMENSION,
  MAP_SCALE_ZOOM,
  type AvatarHandle,
  type AvatarLayerContract,
  type MapAppearance,
  type MapCamera,
  type MapCameraChange,
  type MapCameraOptions,
  type MapDimension,
  MAP_BODY_HANDOVER_ZOOM,
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
  type MapObservedPosition,
  type MapObservedPositionLabel,
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

import type { AvatarCustomLayer } from "./avatar-layer";
import type { MonumentCustomLayer } from "./monument-layer";
import {
  FOG_MARKS_FILL_LAYER_ID,
  FOG_MARKS_OUTLINE_LAYER_ID,
  FOG_MARKS_SOURCE_ID,
  fogMarksData,
  fogMarksLayers,
  fogMarksSource,
} from "./fog-marks";
import landmarkKinds from "./landmark-kinds.json";

import {
  applyObservedPositionLabel,
  createObservedPositionLabelElement,
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
  OBSERVED_POSITION_LABEL_CLASS,
  createObservedPositionLabelElement,
} from "./observed-position-label";

/** The style layer the published styles raise for volumetric building depth. */
export const BUILDING_EXTRUSION_LAYER_ID = "buildings";

/** The style layers whose paint means "a building stands here". */
export const BUILDING_LAYER_IDS: readonly string[] = [
  BUILDING_EXTRUSION_LAYER_ID,
  "buildings-flat",
];

/** The style layers whose paint means "this is water". */
export const WATER_LAYER_IDS: readonly string[] = ["water"];

/** The archive's point-of-interest source layer. */
export const POI_SOURCE_LAYER = "pois";

/**
 * The `kind` values a body treats as worth walking up to. The published
 * archive follows the Protomaps basemap schema; these are the kinds it assigns
 * to monuments, memorials, art and the like. It is read against the archive,
 * not invented: a kind the archive never carries simply never matches, and
 * `deploy/web/inspect-basemap.sh` is what confirms the list against the real
 * `pois` declaration.
 */
export const LANDMARK_KINDS: ReadonlySet<string> = new Set(landmarkKinds);

/** Eased camera transitions stay short enough to read as one continuous world. */
export const MAP_CAMERA_TRANSITION_MS = 900;

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

// Presentation bootstrap only. Keep temporary regional coverage in the
// MapLibre adapter rather than leaking deployment geography into MapRenderer.
export const MAP_BOOTSTRAP_CAMERA: MapCamera = {
  center: [30.5234, 50.4501],
  zoom: MAP_SCALE_ZOOM.city,
  bearing: 0,
  pitch: 32,
};

const pmtilesProtocol = new Protocol();
let pmtilesProtocolRegistered = false;
let workerUrlBound = false;

type MapFactory = (options: MapOptions) => MapLibreMap;

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
  readonly createSelectionMarker?: MapSelectionMarkerFactory;
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
  const createSelectionMarker =
    options.createSelectionMarker ?? createMapLibreSelectionMarker;
  let appearance = options.initialAppearance ?? DEFAULT_MAP_APPEARANCE;
  let dimension = options.initialDimension ?? DEFAULT_MAP_DIMENSION;
  let status: MapRendererStatus = { kind: "unmounted" };
  let camera: MapCamera = initialCamera;
  let map: MapLibreMap | undefined;
  let avatarLayer: AvatarCustomLayer | undefined;
  let avatarLayerPromise: Promise<AvatarCustomLayer> | undefined;
  const avatarHandles = new Map<string, AvatarHandle>();
  let avatarCamera: MapCamera = camera;
  let monumentLayer: MonumentCustomLayer | undefined;
  let monumentLayerPromise: Promise<MonumentCustomLayer> | undefined;

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
        const layer = createMonumentLayer();
        monumentLayer = layer;
        layer.setDimension(dimension);
        if (map !== undefined && firstPaintDone) ensureMonumentLayer(map);
        return layer;
      },
    );
    return monumentLayerPromise;
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
        layer.setCamera(avatarCamera);
        for (const handle of avatarHandles.values()) layer.upsert(handle);
        if (map !== undefined && firstPaintDone && layer.hasInstances()) {
          ensureAvatarLayer(map);
        }
        return layer;
      },
    );
    return avatarLayerPromise;
  }

  const avatars: AvatarLayerContract = {
    upsert(handle) {
      avatarHandles.set(handle.id, handle);
      if (avatarLayer !== undefined) avatarLayer.upsert(handle);
      else void requestAvatarLayer();
    },
    remove(id) {
      avatarHandles.delete(id);
      avatarLayer?.remove(id);
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
  let firstPaintDone = false;
  // A style swap discards every source and layer the renderer owns, so the
  // presentation the application already set has to be reapplied rather than
  // silently lost. This flag is what a style reload resets.
  let presentationApplied = false;
  let observedPosition: MapObservedPosition | null = null;
  let observedLabel: MapObservedPositionLabel | null = null;
  let labelMarker: MapLabelMarker | undefined;
  let labelElement: HTMLElement | undefined;
  let selectionPoint: MapPointSelection | null = null;
  let selectionMarker: MapLabelMarker | undefined;
  let fogMarks: readonly MapFogMark[] = [];
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

  function publishCamera(gesture: boolean): void {
    if (map === undefined) {
      return;
    }
    camera = readCamera(map);
    avatars.setCamera(camera);
    for (const listener of cameraListeners) {
      listener({ camera, gesture });
    }
  }

  function applyDimension(mounted: MapLibreMap): void {
    // The monument is its own custom layer, not a style layer, so it follows
    // dimension whether or not the published style still carries an
    // extrusion layer to match.
    monumentLayer?.setDimension(dimension);

    // Depth is a presentation choice over one geographic truth: the flat mode
    // hides the extrusion and leaves the same footprints the style already
    // paints beneath it.
    if (mounted.getLayer(BUILDING_EXTRUSION_LAYER_ID) === undefined) {
      return;
    }
    mounted.setLayoutProperty(
      BUILDING_EXTRUSION_LAYER_ID,
      "visibility",
      dimension === "flat" ? "none" : "visible",
    );
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
    labelElement.hidden =
      !speaking && mounted.getZoom() >= MAP_BODY_HANDOVER_ZOOM;
  }

  function applyLabel(mounted: MapLibreMap): void {
    if (observedPosition === null || observedLabel === null) {
      labelMarker?.remove();
      labelMarker = undefined;
      labelElement = undefined;
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

  function applyFogMarks(mounted: MapLibreMap): void {
    if (fogMarks.length === 0) {
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

    const source = mounted.getSource(FOG_MARKS_SOURCE_ID) as
      GeoJSONSource | undefined;
    if (source === undefined) {
      mounted.addSource(
        FOG_MARKS_SOURCE_ID,
        fogMarksSource(fogMarks) as unknown as SourceSpecification,
      );
    } else {
      source.setData(
        fogMarksData(fogMarks) as Parameters<GeoJSONSource["setData"]>[0],
      );
    }
    // Beneath the observation, so the Bond's own marker stays on top of the
    // cells around it; the observation layers are appended after these.
    const before = [
      OBSERVED_POSITION_CELL_LAYER_ID,
      OBSERVED_POSITION_CELL_OUTLINE_LAYER_ID,
    ].find((id) => mounted.getLayer(id) !== undefined);
    for (const layer of fogMarksLayers()) {
      if (mounted.getLayer(String(layer.id)) === undefined) {
        mounted.addLayer(layer as unknown as LayerSpecification, before);
      }
    }
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

  function applyPresentation(mounted: MapLibreMap): void {
    applyDimension(mounted);
    applyFogMarks(mounted);
    applyObservedPosition(mounted);
    applySelectionPoint(mounted);
    if (firstPaintDone && avatarLayer?.hasInstances())
      ensureAvatarLayer(mounted);
    if (firstPaintDone) {
      ensureMonumentLayer(mounted);
      void requestMonumentLayer();
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
  ): MapObstacle["polygons"] {
    const layer = mounted.getLayer(layerId) as
      | {
          readonly source?: string;
          readonly sourceLayer?: string;
          readonly filter?: FilterSpecification | null;
        }
      | undefined;
    if (layer?.source === undefined || layer.sourceLayer === undefined) {
      return [];
    }
    if (mounted.getSource(layer.source) === undefined) return [];
    const polygons: (readonly (readonly [number, number])[])[][] = [];
    for (const feature of mounted.querySourceFeatures(layer.source, {
      sourceLayer: layer.sourceLayer,
      ...(layer.filter == null ? {} : { filter: layer.filter }),
    })) {
      const geometry = feature.geometry as {
        readonly type: string;
        readonly coordinates: unknown;
      };
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
      }
    }
    return polygons;
  }

  function landmarkFrom(feature: {
    readonly id?: string | number | undefined;
    readonly geometry: { readonly type: string };
    readonly properties: Record<string, unknown> | null;
  }): MapLandmark | undefined {
    if (feature.geometry.type !== "Point") return undefined;
    const [longitude, latitude] = (
      feature.geometry as unknown as { coordinates: [number, number] }
    ).coordinates;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      return undefined;
    }
    const properties = feature.properties ?? {};
    const kind = properties.kind;
    if (typeof kind !== "string" || !LANDMARK_KINDS.has(kind)) return undefined;
    const name = typeof properties.name === "string" ? properties.name : "";
    const facts: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (key === "kind" || key === "name") continue;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        facts[key] = value;
      }
    }
    // A feature id is the archive's own and survives a tile boundary; without
    // one the place itself is the identity, rounded to well under a metre.
    const id =
      feature.id === undefined
        ? `${kind}:${name}:${longitude.toFixed(6)},${latitude.toFixed(6)}`
        : `poi:${String(feature.id)}`;
    return {
      id,
      longitude,
      latitude,
      kind,
      ...(name.length === 0 ? {} : { name }),
      facts,
    };
  }

  function releaseLabel(): void {
    labelMarker?.remove();
    labelMarker = undefined;
    labelElement = undefined;
  }

  function releaseSelectionMarker(): void {
    selectionMarker?.remove();
    selectionMarker = undefined;
  }

  return {
    avatars,

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
        styleResolved = false;
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
        // moveend rather than move: camera state reaches the application once
        // per gesture instead of once per frame.
        mountedMap.on("moveend", (event: { originalEvent?: unknown }) => {
          publishCamera(event?.originalEvent !== undefined);
        });
        // "idle" is MapLibre saying every tile the view needs has loaded and
        // painted: the one moment new landmarks can have become readable. It
        // fires once per settle, not once per tile.
        mountedMap.on("idle", () => {
          for (const listener of [...landmarkListeners]) listener();
        });
        mountedMap.on("zoom", () => {
          updateLabelVisibility(mountedMap);
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
        mountedMap.once("load", () => {
          styleResolved = true;
          firstPaintDone = true;
          applyPresentation(mountedMap);

          if (container.isConnected) {
            const bounds = container.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) {
              publish({ kind: "unavailable", reason: "container-zero-size" });
              return;
            }
          }

          publish({ kind: "ready" });
        });
      } catch {
        map = undefined;
        publish({ kind: "unavailable", reason: "renderer-init-failed" });
      }
    },

    unmount() {
      releaseLabel();
      releaseSelectionMarker();
      map?.remove();
      map = undefined;
      styleResolved = false;
      firstPaintDone = false;
      presentationApplied = false;
      publish({ kind: "unmounted" });
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

    landmarksNear(point, radiusMeters) {
      if (map === undefined || !validPoint(point)) return [];
      const sourceId = map.getLayer(POI_SOURCE_LAYER)?.source ?? "basemap";
      if (map.getSource(sourceId) === undefined) return [];
      const found = new Map<
        string,
        { landmark: MapLandmark; distance: number }
      >();
      for (const feature of map.querySourceFeatures(sourceId, {
        sourceLayer: POI_SOURCE_LAYER,
      })) {
        const landmark = landmarkFrom(feature);
        if (landmark === undefined || found.has(landmark.id)) continue;
        const distance = mapDistanceMeters(point, landmark);
        if (distance <= radiusMeters)
          found.set(landmark.id, { landmark, distance });
      }
      return [...found.values()]
        .sort((a, b) => a.distance - b.distance)
        .map((entry) => entry.landmark);
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
          const polygons = polygonsPainted(mounted, layerId, bounds);
          if (polygons.length === 0) continue;
          obstacles.push({ kind, polygons });
          return;
        }
      };
      collect("building", BUILDING_LAYER_IDS);
      collect("water", WATER_LAYER_IDS);
      return obstacles;
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
        map?.easeTo({ ...target, duration: MAP_CAMERA_TRANSITION_MS });
        return;
      }

      map?.jumpTo(target);
    },

    setAppearance(next: MapAppearance) {
      if (next === appearance) {
        return;
      }

      appearance = next;

      if (map === undefined) {
        return;
      }

      // A style swap keeps the current camera and reopens the style phase so a
      // missing appearance variant is reported instead of blanking the map.
      styleResolved = false;
      presentationApplied = false;
      map.setStyle(styleUrls[next]);
    },

    setDimension(next: MapDimension) {
      if (next === dimension) {
        return;
      }

      dimension = next;

      if (map !== undefined) {
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
