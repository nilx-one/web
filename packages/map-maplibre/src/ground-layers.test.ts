// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import type {
  CustomLayerInterface,
  Map as MapLibreMap,
  MapOptions,
} from "maplibre-gl";

import { createMapLibreRenderer } from "./index";

type Listener = (payload: Record<string, unknown>) => void;

function makeStyledMap(
  styleLayers: readonly { id: string; type: string }[] | undefined,
) {
  const listeners = new Map<string, Listener[]>();
  const layers: { id: string; before?: string | undefined }[] = [];
  const styleReads = { count: 0 };
  const map = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return map;
    },
    once(event: string, listener: Listener) {
      return map.on(event, listener);
    },
    emit(event: string) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener({});
    },
    getStyle: () => {
      styleReads.count += 1;
      // An unloaded style has nothing to report, which is the case the
      // renderer has to fall back from rather than throw on.
      return styleLayers === undefined
        ? undefined
        : { layers: [...styleLayers] };
    },
    addLayer: vi.fn((layer: { id: string }, before?: string) => {
      layers.push({ id: layer.id, before });
    }),
    getLayer: (id: string) =>
      layers.find((entry) => entry.id === id) as unknown as undefined,
    remove: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    setStyle: vi.fn(),
    addSource: vi.fn(),
    removeSource: vi.fn(),
    removeLayer: vi.fn(),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    getSource: () => undefined,
    getCenter: () => ({ lng: 30.5234, lat: 50.4501 }),
    getZoom: () => 11,
    getBearing: () => 0,
    getPitch: () => 32,
    project: () => ({ x: 0, y: 0 }),
    layers,
    styleReads,
  };
  return map;
}

function groundLayer(id: string): CustomLayerInterface {
  return { id, type: "custom", render: () => undefined };
}

function mountWith(
  map: ReturnType<typeof makeStyledMap>,
  groundLayers: readonly CustomLayerInterface[],
) {
  const renderer = createMapLibreRenderer({
    createMap: (_options: MapOptions) => map as unknown as MapLibreMap,
    groundLayers,
  });
  renderer.mount(document.createElement("div"));
  map.emit("load");
  return renderer;
}

describe("ground layers", () => {
  it("adds a ground layer beneath the style's first symbol layer", () => {
    const map = makeStyledMap([
      { id: "background", type: "background" },
      { id: "buildings", type: "fill-extrusion" },
      { id: "place-labels", type: "symbol" },
      { id: "road-labels", type: "symbol" },
    ]);

    mountWith(map, [groundLayer("shade")]);

    expect(map.layers).toContainEqual({ id: "shade", before: "place-labels" });
  });

  it("appends a ground layer when the style has no symbols at all", () => {
    const map = makeStyledMap([{ id: "background", type: "background" }]);

    mountWith(map, [groundLayer("shade")]);

    expect(map.layers).toContainEqual({ id: "shade", before: undefined });
  });

  it("appends when the style is not readable yet", () => {
    const map = makeStyledMap(undefined);

    mountWith(map, [groundLayer("shade")]);

    expect(map.layers).toContainEqual({ id: "shade", before: undefined });
  });

  it("appends when the map cannot report a style at all", () => {
    const map = makeStyledMap([{ id: "labels", type: "symbol" }]);
    const withoutStyle = { ...map, getStyle: undefined };

    mountWith(withoutStyle as unknown as ReturnType<typeof makeStyledMap>, [
      groundLayer("shade"),
    ]);

    expect(map.layers).toContainEqual({ id: "shade", before: undefined });
  });

  it("adds each ground layer once, however often presentation is applied", () => {
    const map = makeStyledMap([{ id: "labels", type: "symbol" }]);

    const renderer = mountWith(map, [groundLayer("shade")]);
    renderer.setAppearance("dark");
    renderer.setDimension("flat");

    expect(map.layers.filter((entry) => entry.id === "shade")).toHaveLength(1);
  });

  it("never reads the style when nothing composed a ground layer", () => {
    const map = makeStyledMap([{ id: "labels", type: "symbol" }]);

    mountWith(map, []);

    expect(map.styleReads.count).toBe(0);
    expect(map.layers).toEqual([]);
  });
});
