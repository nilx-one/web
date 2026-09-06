// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_MAP_APPEARANCE,
  type MapAppearance,
  type MapCamera,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import {
  GPUInitializationError,
  Map as MapLibreMap,
  addProtocol,
  getWorkerUrl,
  setWorkerUrl,
  type MapOptions,
} from "maplibre-gl";
// MapLibre resolves its worker from its own module URL. An application build
// inlines the library into an application chunk, so that URL names a file the
// deployment never publishes: the worker never starts, every source stalls
// behind it, and the map dies on the load timeout instead of on a cause. The
// application bundler emits the worker as its own asset here and the renderer
// binds that published URL before the first map is created.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Protocol } from "pmtiles";

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
  zoom: 10,
  bearing: 0,
  pitch: 32,
};

const pmtilesProtocol = new Protocol();
let pmtilesProtocolRegistered = false;
let workerUrlBound = false;

type MapFactory = (options: MapOptions) => MapLibreMap;

export interface MapLibreRendererOptions {
  readonly styleUrls?: Readonly<Record<MapAppearance, string>>;
  readonly initialAppearance?: MapAppearance;
  readonly initialCamera?: MapCamera;
  readonly createMap?: MapFactory;
  readonly loadTimeoutMs?: number;
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
  let appearance = options.initialAppearance ?? DEFAULT_MAP_APPEARANCE;
  let status: MapRendererStatus = { kind: "unmounted" };
  let map: MapLibreMap | undefined;
  let loadTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  // Style documents resolve before sources and tiles do, so the phase a
  // failure arrives in is what distinguishes a missing style from a missing
  // basemap from ordinary tile noise on a map that already renders.
  let styleResolved = false;
  let firstPaintDone = false;
  const listeners = new Set<(next: MapRendererStatus) => void>();

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
          center: [...initialCamera.center],
          zoom: initialCamera.zoom,
          bearing: initialCamera.bearing,
          pitch: initialCamera.pitch,
        });
        map = mountedMap;
        styleResolved = false;
        firstPaintDone = false;

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
        });
        mountedMap.on("error", (event) => {
          reportRendererError(event.error);
        });
        mountedMap.once("load", () => {
          styleResolved = true;
          firstPaintDone = true;

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
      map?.remove();
      map = undefined;
      styleResolved = false;
      firstPaintDone = false;
      publish({ kind: "unmounted" });
    },

    getStatus() {
      return status;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    setCamera(camera: MapCamera) {
      map?.jumpTo({
        center: [...camera.center],
        zoom: camera.zoom,
        bearing: camera.bearing,
        pitch: camera.pitch,
      });
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
      map.setStyle(styleUrls[next]);
    },
  };
}
