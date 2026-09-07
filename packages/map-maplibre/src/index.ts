// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_MAP_APPEARANCE,
  DEFAULT_MAP_DIMENSION,
  MAP_SCALE_ZOOM,
  type MapAppearance,
  type MapCamera,
  type MapCameraChange,
  type MapCameraOptions,
  type MapDimension,
  type MapObservedPosition,
  type MapObservedPositionLabel,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import {
  GPUInitializationError,
  Map as MapLibreMap,
  Marker,
  addProtocol,
  getWorkerUrl,
  setWorkerUrl,
  type DataDrivenPropertyValueSpecification,
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
  applyObservedPositionLabel,
  createObservedPositionLabelElement,
} from "./observed-position-label";
import {
  OBSERVED_POSITION_ACCURACY_LAYER_ID,
  OBSERVED_POSITION_EDGE_LAYER_ID,
  OBSERVED_POSITION_LABEL_MIN_ZOOM,
  OBSERVED_POSITION_POINT_LAYER_ID,
  OBSERVED_POSITION_SOURCE_ID,
  accuracyRadiusExpression,
  observedPositionLayers,
  observedPositionSource,
} from "./observed-position";

export {
  OBSERVED_POSITION_ACCURACY_LAYER_ID,
  OBSERVED_POSITION_EDGE_LAYER_ID,
  OBSERVED_POSITION_LABEL_MIN_ZOOM,
  OBSERVED_POSITION_POINT_LAYER_ID,
  OBSERVED_POSITION_SOURCE_ID,
  accuracyRadiusExpression,
  clampAccuracyMeters,
} from "./observed-position";
export {
  OBSERVED_POSITION_LABEL_CLASS,
  createObservedPositionLabelElement,
} from "./observed-position-label";

/** The style layer the published styles raise for volumetric building depth. */
export const BUILDING_EXTRUSION_LAYER_ID = "buildings";

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

export interface MapLibreRendererOptions {
  readonly styleUrls?: Readonly<Record<MapAppearance, string>>;
  readonly initialAppearance?: MapAppearance;
  readonly initialDimension?: MapDimension;
  readonly initialCamera?: MapCamera;
  readonly createMap?: MapFactory;
  readonly createLabelMarker?: MapLabelMarkerFactory;
  readonly loadTimeoutMs?: number;
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

export function createMapLibreRenderer(
  options: MapLibreRendererOptions = {},
): MapRenderer {
  const styleUrls = options.styleUrls ?? MAP_STYLE_URLS;
  const initialCamera = options.initialCamera ?? MAP_BOOTSTRAP_CAMERA;
  const loadTimeoutMs = options.loadTimeoutMs ?? MAP_RENDER_LOAD_TIMEOUT_MS;
  const createMap =
    options.createMap ?? ((mapOptions) => new MapLibreMap(mapOptions));
  const createLabelMarker =
    options.createLabelMarker ?? createMapLibreLabelMarker;
  let appearance = options.initialAppearance ?? DEFAULT_MAP_APPEARANCE;
  let dimension = options.initialDimension ?? DEFAULT_MAP_DIMENSION;
  let status: MapRendererStatus = { kind: "unmounted" };
  let camera: MapCamera = initialCamera;
  let map: MapLibreMap | undefined;
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
  const listeners = new Set<(next: MapRendererStatus) => void>();
  const cameraListeners = new Set<(change: MapCameraChange) => void>();

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
    for (const listener of cameraListeners) {
      listener({ camera, gesture });
    }
  }

  function applyDimension(mounted: MapLibreMap): void {
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

  function updateLabelVisibility(mounted: MapLibreMap): void {
    if (labelElement === undefined) {
      return;
    }
    labelElement.hidden = mounted.getZoom() < OBSERVED_POSITION_LABEL_MIN_ZOOM;
  }

  function applyLabel(mounted: MapLibreMap): void {
    if (observedPosition === null || observedLabel === null) {
      labelMarker?.remove();
      labelMarker = undefined;
      labelElement = undefined;
      return;
    }

    const center: [number, number] = [
      observedPosition.center[0],
      observedPosition.center[1],
    ];

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

  function removeObservedPositionLayers(mounted: MapLibreMap): void {
    for (const layerId of [
      OBSERVED_POSITION_ACCURACY_LAYER_ID,
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

  function applyPresentation(mounted: MapLibreMap): void {
    applyDimension(mounted);
    applyObservedPosition(mounted);
    presentationApplied = true;
  }

  function releaseLabel(): void {
    labelMarker?.remove();
    labelMarker = undefined;
    labelElement = undefined;
  }

  return {
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
        mountedMap.on("zoom", () => {
          updateLabelVisibility(mountedMap);
        });
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

    setCamera(next: MapCamera, cameraOptions: MapCameraOptions = {}) {
      camera = next;

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
  };
}
