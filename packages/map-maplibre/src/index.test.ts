// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import {
  MAP_BOOTSTRAP_CAMERA,
  MAP_STYLE_URL,
  MAP_STYLE_URLS,
  createMapLibreRenderer,
  resolvePmtilesProtocolUrl,
} from "./index";

interface FakeMap {
  readonly on: (event: string, listener: () => void) => FakeMap;
  readonly once: (event: string, listener: () => void) => FakeMap;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly jumpTo: ReturnType<typeof vi.fn>;
  readonly setStyle: ReturnType<typeof vi.fn>;
  emit(event: string): void;
}

function makeFakeMap(): FakeMap {
  const listeners = new Map<string, (() => void)[]>();
  const remember = (event: string, listener: () => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  };
  const fake: FakeMap = {
    on(event, listener) {
      remember(event, listener);
      return fake;
    },
    once(event, listener) {
      remember(event, () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((entry) => entry !== listener),
        );
        listener();
      });
      return fake;
    },
    remove: vi.fn(),
    jumpTo: vi.fn(),
    setStyle: vi.fn(),
    emit(event) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener();
      }
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
