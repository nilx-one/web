// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapRenderer,
  MapRendererStatus,
} from "@nilx-one/map-contract";
import { Map as MapLibreMap, addProtocol, type MapOptions } from "maplibre-gl";
import { Protocol } from "pmtiles";

export const MAP_STYLE_CONTRACT_VERSION = "0.1.0";
export const MAP_STYLE_URL = `/map/${MAP_STYLE_CONTRACT_VERSION}/style.json`;
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

type MapFactory = (options: MapOptions) => MapLibreMap;

export interface MapLibreRendererOptions {
  readonly styleUrl?: string;
  readonly initialCamera?: MapCamera;
  readonly createMap?: MapFactory;
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

export function createMapLibreRenderer(
  options: MapLibreRendererOptions = {},
): MapRenderer {
  const styleUrl = options.styleUrl ?? MAP_STYLE_URL;
  const initialCamera = options.initialCamera ?? MAP_BOOTSTRAP_CAMERA;
  const createMap =
    options.createMap ?? ((mapOptions) => new MapLibreMap(mapOptions));
  let status: MapRendererStatus = { kind: "unmounted" };
  let map: MapLibreMap | undefined;
  const listeners = new Set<(next: MapRendererStatus) => void>();

  function publish(next: MapRendererStatus): void {
    status = next;
    for (const listener of listeners) {
      listener(next);
    }
  }

  return {
    mount(container) {
      if (map !== undefined) {
        return;
      }

      publish({ kind: "loading" });

      try {
        ensurePmtilesProtocol();
        const mountedMap = createMap({
          container,
          style: styleUrl,
          center: [...initialCamera.center],
          zoom: initialCamera.zoom,
          bearing: initialCamera.bearing,
          pitch: initialCamera.pitch,
        });
        map = mountedMap;

        mountedMap.once("load", () => publish({ kind: "ready" }));
        mountedMap.once("error", () =>
          publish({ kind: "unavailable", reason: "style-load-failed" }),
        );
      } catch {
        map = undefined;
        publish({ kind: "unavailable", reason: "renderer-init-failed" });
      }
    },

    unmount() {
      map?.remove();
      map = undefined;
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
  };
}
