// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import {
  BUILDING_EXTRUSION_LAYER_ID,
  MAP_BOOTSTRAP_CAMERA,
  MAP_CAMERA_TRANSITION_MS,
  MAP_STYLE_URL,
  MAP_STYLE_URLS,
  OBSERVED_POSITION_ACCURACY_LAYER_ID,
  OBSERVED_POSITION_EDGE_LAYER_ID,
  OBSERVED_POSITION_LABEL_MIN_ZOOM,
  OBSERVED_POSITION_POINT_LAYER_ID,
  OBSERVED_POSITION_SOURCE_ID,
  createMapLibreRenderer,
  resolvePmtilesProtocolUrl,
  type MapLabelMarker,
  type MapLabelMarkerFactory,
} from "./index";

type FakeListener = (event: {
  readonly error?: unknown;
  readonly originalEvent?: unknown;
}) => void;

interface FakeCamera {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

interface FakeMap {
  readonly on: (event: string, listener: FakeListener) => FakeMap;
  readonly once: (event: string, listener: FakeListener) => FakeMap;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly jumpTo: ReturnType<typeof vi.fn>;
  readonly easeTo: ReturnType<typeof vi.fn>;
  readonly setStyle: ReturnType<typeof vi.fn>;
  readonly addSource: ReturnType<typeof vi.fn>;
  readonly removeSource: ReturnType<typeof vi.fn>;
  readonly addLayer: ReturnType<typeof vi.fn>;
  readonly removeLayer: ReturnType<typeof vi.fn>;
  readonly setPaintProperty: ReturnType<typeof vi.fn>;
  readonly setLayoutProperty: ReturnType<typeof vi.fn>;
  readonly getSource: (id: string) => unknown;
  readonly getLayer: (id: string) => unknown;
  readonly getCenter: () => { lng: number; lat: number };
  readonly getZoom: () => number;
  readonly getBearing: () => number;
  readonly getPitch: () => number;
  readonly camera: FakeCamera;
  readonly sources: Map<string, { setData: ReturnType<typeof vi.fn> }>;
  readonly layers: Map<string, Record<string, unknown>>;
  readonly paint: Map<string, unknown>;
  readonly layout: Map<string, unknown>;
  emit(
    event: string,
    payload?: { error?: unknown; originalEvent?: unknown },
  ): void;
  /** A style swap discards everything the renderer added, as MapLibre does. */
  reloadStyle(): void;
}

function makeFakeMap(): FakeMap {
  const listeners = new Map<string, FakeListener[]>();
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Map<string, Record<string, unknown>>();
  const paint = new Map<string, unknown>();
  const layout = new Map<string, unknown>();
  const camera: FakeCamera = {
    center: [30.5234, 50.4501],
    zoom: 11,
    bearing: 0,
    pitch: 32,
  };
  const remember = (event: string, listener: FakeListener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  };
  const fake: FakeMap = {
    on(event, listener) {
      remember(event, listener);
      return fake;
    },
    once(event, listener) {
      remember(event, (payload) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((entry) => entry !== listener),
        );
        listener(payload);
      });
      return fake;
    },
    remove: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    setStyle: vi.fn(),
    addSource: vi.fn((id: string) => {
      sources.set(id, { setData: vi.fn() });
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id);
    }),
    addLayer: vi.fn((layer: Record<string, unknown>) => {
      layers.set(String(layer.id), layer);
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id);
    }),
    setPaintProperty: vi.fn((id: string, property: string, value: unknown) => {
      paint.set(`${id}.${property}`, value);
    }),
    setLayoutProperty: vi.fn((id: string, property: string, value: unknown) => {
      layout.set(`${id}.${property}`, value);
    }),
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    getCenter: () => ({ lng: camera.center[0], lat: camera.center[1] }),
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    camera,
    sources,
    layers,
    paint,
    layout,
    emit(event, payload) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener(payload ?? {});
      }
    },
    reloadStyle() {
      layers.clear();
      sources.clear();
      fake.emit("styledata");
    },
  };
  return fake;
}

function mountedRenderer(fakeMap: FakeMap) {
  return createMapLibreRenderer({
    createMap: (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
  });
}

describe("resolvePmtilesProtocolUrl", () => {
  it("resolves the portable same-origin PMTiles URL to an absolute browser transport URL", () => {
    expect(
      resolvePmtilesProtocolUrl(
        "pmtiles:///map/0.1.0/basemap.pmtiles",
        "https://nilx.one/",
      ),
    ).toBe("pmtiles://https://nilx.one/map/0.1.0/basemap.pmtiles");
  });

  it("leaves already absolute PMTiles transport URLs unchanged", () => {
    const url = "pmtiles://https://cdn.example/map.pmtiles";
    expect(resolvePmtilesProtocolUrl(url, "https://nilx.one/")).toBe(url);
  });
});

describe("published map style contract", () => {
  it("publishes one versioned same-origin style document per appearance", () => {
    expect(MAP_STYLE_URLS).toEqual({
      light: "/map/0.1.0/style.json",
      dark: "/map/0.1.0/style-dark.json",
    });
    expect(MAP_STYLE_URL).toBe(MAP_STYLE_URLS.light);
  });
});

describe("createMapLibreRenderer", () => {
  it("boots the regional presentation camera without changing the shared map contract", () => {
    const fakeMap = makeFakeMap();
    const createMap = vi.fn(
      (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
    );
    const container = document.createElement("div");

    createMapLibreRenderer({ createMap }).mount(container);

    expect(createMap).toHaveBeenCalledWith({
      container,
      style: MAP_STYLE_URL,
      center: [...MAP_BOOTSTRAP_CAMERA.center],
      zoom: MAP_BOOTSTRAP_CAMERA.zoom,
      bearing: MAP_BOOTSTRAP_CAMERA.bearing,
      pitch: MAP_BOOTSTRAP_CAMERA.pitch,
    });
  });

  it("accepts an explicit composition camera", () => {
    const fakeMap = makeFakeMap();
    const createMap = vi.fn(
      (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
    );
    const initialCamera = {
      center: [1, 2] as const,
      zoom: 3,
      bearing: 4,
      pitch: 5,
    };

    createMapLibreRenderer({ createMap, initialCamera }).mount(
      document.createElement("div"),
    );

    expect(createMap.mock.calls[0]?.[0]).toMatchObject({
      center: [1, 2],
      zoom: 3,
      bearing: 4,
      pitch: 5,
    });
  });

  it("publishes loading then ready and owns renderer cleanup", () => {
    const fakeMap = makeFakeMap();
    const statuses: string[] = [];
    const createMap = vi.fn(
      (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
    );
    const renderer = createMapLibreRenderer({ createMap });
    renderer.subscribe((status) => statuses.push(status.kind));

    renderer.mount(document.createElement("div"));
    expect(statuses).toEqual(["loading"]);

    fakeMap.emit("load");
    expect(renderer.getStatus()).toEqual({ kind: "ready" });

    renderer.setCamera({
      center: [10, 20],
      zoom: 4,
      bearing: 5,
      pitch: 6,
    });
    expect(fakeMap.jumpTo).toHaveBeenCalledWith({
      center: [10, 20],
      zoom: 4,
      bearing: 5,
      pitch: 6,
    });

    renderer.unmount();
    expect(fakeMap.remove).toHaveBeenCalledOnce();
    expect(renderer.getStatus()).toEqual({ kind: "unmounted" });
  });

  it("fails explicitly when the self-hosted style cannot load", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("error");

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "style-load-failed",
    });
  });

  it("separates a readable style from an unreadable basemap archive", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("styledata");
    fakeMap.emit("error");

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "basemap-load-failed",
    });
  });

  it("keeps a rendering map ready when late tile errors arrive", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("load");
    fakeMap.emit("error");

    expect(renderer.getStatus()).toEqual({ kind: "ready" });
  });

  it("mounts the appearance variant requested before the first paint", () => {
    const fakeMap = makeFakeMap();
    const createMap = vi.fn(
      (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
    );
    const renderer = createMapLibreRenderer({ createMap });

    renderer.setAppearance("dark");
    renderer.mount(document.createElement("div"));

    expect(createMap.mock.calls[0]?.[0]).toMatchObject({
      style: MAP_STYLE_URLS.dark,
    });
    expect(fakeMap.setStyle).not.toHaveBeenCalled();
  });

  it("swaps the published style variant on a mounted map without re-mounting", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("load");
    renderer.setAppearance("dark");

    expect(fakeMap.setStyle).toHaveBeenCalledWith(MAP_STYLE_URLS.dark);
    expect(fakeMap.remove).not.toHaveBeenCalled();
    expect(renderer.getStatus()).toEqual({ kind: "ready" });
  });

  it("ignores an appearance that is already presented", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("load");
    renderer.setAppearance("light");

    expect(fakeMap.setStyle).not.toHaveBeenCalled();
  });

  it("reports a missing appearance variant instead of blanking the map", () => {
    const fakeMap = makeFakeMap();
    const renderer = mountedRenderer(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("load");
    renderer.setAppearance("dark");
    fakeMap.emit("error");

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "style-load-failed",
    });
  });
});

const OBSERVED = {
  center: [30.5234, 50.4501] as const,
  accuracyMeters: 24,
};

function labelMarkers() {
  const markers: {
    element: HTMLElement;
    center: [number, number];
    removed: boolean;
  }[] = [];

  const createLabelMarker = (
    _map: MapLibreMap,
    element: HTMLElement,
    center: [number, number],
  ): MapLabelMarker => {
    const entry = { element, center, removed: false };
    markers.push(entry);
    return {
      setLngLat: (next) => {
        entry.center = next;
      },
      remove: () => {
        entry.removed = true;
      },
    };
  };

  return { markers, createLabelMarker };
}

function readyRenderer(
  fakeMap: FakeMap,
  createLabelMarker?: MapLabelMarkerFactory,
) {
  const renderer = createMapLibreRenderer({
    createMap: (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
    ...(createLabelMarker === undefined ? {} : { createLabelMarker }),
  });
  renderer.mount(document.createElement("div"));
  fakeMap.emit("load");
  return renderer;
}

describe("observed device position", () => {
  it("adds the point, its edge and a geographic accuracy halo above the basemap", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setObservedPosition(OBSERVED);

    expect(fakeMap.sources.has(OBSERVED_POSITION_SOURCE_ID)).toBe(true);
    expect([...fakeMap.layers.keys()]).toEqual([
      OBSERVED_POSITION_ACCURACY_LAYER_ID,
      OBSERVED_POSITION_EDGE_LAYER_ID,
      OBSERVED_POSITION_POINT_LAYER_ID,
    ]);

    const accuracy = fakeMap.layers.get(OBSERVED_POSITION_ACCURACY_LAYER_ID);
    const radius = (accuracy?.paint as Record<string, unknown>)[
      "circle-radius"
    ] as [string, unknown[], ...unknown[]];
    // A ground radius doubles per zoom level, so the halo is interpolated on
    // base 2 rather than pinned to a screen-space size.
    expect(radius[0]).toBe("min");
    expect((radius[1] as unknown[])[1]).toEqual(["exponential", 2]);
  });

  it("updates a live observation in place instead of recreating the source", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setObservedPosition(OBSERVED);
    renderer.setObservedPosition({
      center: [30.524, 50.4503],
      accuracyMeters: 12,
    });

    expect(fakeMap.addSource).toHaveBeenCalledOnce();
    expect(fakeMap.addLayer).toHaveBeenCalledTimes(3);
    expect(
      fakeMap.sources.get(OBSERVED_POSITION_SOURCE_ID)?.setData,
    ).toHaveBeenCalledOnce();
    expect(
      fakeMap.paint.get(`${OBSERVED_POSITION_ACCURACY_LAYER_ID}.circle-radius`),
    ).toBeDefined();
    expect(fakeMap.setStyle).not.toHaveBeenCalled();
    expect(fakeMap.remove).not.toHaveBeenCalled();
  });

  it("clears every location resource when the observation is withdrawn", () => {
    const fakeMap = makeFakeMap();
    const { markers, createLabelMarker } = labelMarkers();
    const renderer = readyRenderer(fakeMap, createLabelMarker);

    renderer.setObservedPosition(OBSERVED);
    renderer.setObservedPositionLabel({ title: "0x0sky" });
    renderer.setObservedPosition(null);

    expect(fakeMap.layers.size).toBe(0);
    expect(fakeMap.sources.size).toBe(0);
    expect(markers[0]?.removed).toBe(true);
  });

  it("restores the overlay after an appearance style swap", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setObservedPosition(OBSERVED);
    renderer.setAppearance("dark");
    fakeMap.reloadStyle();

    expect(fakeMap.sources.has(OBSERVED_POSITION_SOURCE_ID)).toBe(true);
    expect(fakeMap.layers.size).toBe(3);
  });

  it("releases location resources on unmount", () => {
    const fakeMap = makeFakeMap();
    const { markers, createLabelMarker } = labelMarkers();
    const renderer = readyRenderer(fakeMap, createLabelMarker);

    renderer.setObservedPosition(OBSERVED);
    renderer.setObservedPositionLabel({ title: "0x0sky" });
    renderer.unmount();

    expect(markers[0]?.removed).toBe(true);
    expect(fakeMap.remove).toHaveBeenCalledOnce();
  });
});

describe("observed position label", () => {
  it("presents application-supplied text and follows the observation", () => {
    const fakeMap = makeFakeMap();
    const { markers, createLabelMarker } = labelMarkers();
    const renderer = readyRenderer(fakeMap, createLabelMarker);

    renderer.setObservedPosition(OBSERVED);
    renderer.setObservedPositionLabel({
      title: "0x0sky",
      detail: "Kyiv, Ukraine",
    });
    renderer.setObservedPosition({
      center: [30.53, 50.46],
      accuracyMeters: 18,
    });

    expect(markers).toHaveLength(1);
    expect(markers[0]?.element.textContent).toContain("0x0sky");
    expect(markers[0]?.element.textContent).toContain("Kyiv, Ukraine");
    expect(markers[0]?.center).toEqual([30.53, 50.46]);
  });

  it("keeps identity context for close zoom only", () => {
    const fakeMap = makeFakeMap();
    const { markers, createLabelMarker } = labelMarkers();
    const renderer = readyRenderer(fakeMap, createLabelMarker);

    renderer.setObservedPosition(OBSERVED);
    renderer.setObservedPositionLabel({ title: "0x0sky" });

    expect(markers[0]?.element.hidden).toBe(true);

    fakeMap.camera.zoom = OBSERVED_POSITION_LABEL_MIN_ZOOM;
    fakeMap.emit("zoom");

    expect(markers[0]?.element.hidden).toBe(false);
  });

  it("never draws a label without an observation to anchor it to", () => {
    const fakeMap = makeFakeMap();
    const { markers, createLabelMarker } = labelMarkers();
    const renderer = readyRenderer(fakeMap, createLabelMarker);

    renderer.setObservedPositionLabel({ title: "0x0sky" });

    expect(markers).toHaveLength(0);
  });
});

describe("camera ownership", () => {
  it("eases a requested transition and honours viewport padding", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setCamera(
      { center: [30.52, 50.45], zoom: 13, bearing: 0, pitch: 40 },
      {
        motion: "eased",
        padding: { top: 80, right: 16, bottom: 220, left: 16 },
      },
    );

    expect(fakeMap.easeTo).toHaveBeenCalledWith({
      center: [30.52, 50.45],
      zoom: 13,
      bearing: 0,
      pitch: 40,
      padding: { top: 80, right: 16, bottom: 220, left: 16 },
      duration: MAP_CAMERA_TRANSITION_MS,
    });
    expect(fakeMap.jumpTo).not.toHaveBeenCalled();
  });

  it("cuts immediately when motion is not requested", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setCamera({ center: [1, 2], zoom: 3, bearing: 0, pitch: 0 });

    expect(fakeMap.jumpTo).toHaveBeenCalledOnce();
    expect(fakeMap.easeTo).not.toHaveBeenCalled();
  });

  it("separates a person moving the camera from the application moving it", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);
    const changes: boolean[] = [];
    renderer.subscribeCamera((change) => changes.push(change.gesture));

    fakeMap.camera.zoom = 15;
    fakeMap.emit("moveend", { originalEvent: { type: "wheel" } });
    fakeMap.emit("moveend");

    expect(changes).toEqual([true, false]);
    expect(renderer.getCamera().zoom).toBe(15);
  });

  it("stops publishing camera changes after unsubscribe", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);
    const listener = vi.fn();

    renderer.subscribeCamera(listener)();
    fakeMap.emit("moveend");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("presentation dimension", () => {
  it("suppresses building extrusion in explicit 2D without touching geography", () => {
    const fakeMap = makeFakeMap();
    fakeMap.layers.set(BUILDING_EXTRUSION_LAYER_ID, {
      id: BUILDING_EXTRUSION_LAYER_ID,
    });
    const renderer = readyRenderer(fakeMap);

    renderer.setDimension("flat");

    expect(
      fakeMap.layout.get(`${BUILDING_EXTRUSION_LAYER_ID}.visibility`),
    ).toBe("none");

    renderer.setDimension("volumetric");

    expect(
      fakeMap.layout.get(`${BUILDING_EXTRUSION_LAYER_ID}.visibility`),
    ).toBe("visible");
  });

  it("reapplies the selected dimension after a style reload", () => {
    const fakeMap = makeFakeMap();
    const renderer = readyRenderer(fakeMap);

    renderer.setDimension("flat");
    fakeMap.layers.set(BUILDING_EXTRUSION_LAYER_ID, {
      id: BUILDING_EXTRUSION_LAYER_ID,
    });
    renderer.setAppearance("dark");
    fakeMap.emit("styledata");

    expect(
      fakeMap.layout.get(`${BUILDING_EXTRUSION_LAYER_ID}.visibility`),
    ).toBe("none");
  });
});
