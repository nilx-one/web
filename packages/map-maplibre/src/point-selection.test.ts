// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { createMapLibreRenderer, type MapLabelMarker } from "./index";

type Listener = (event: unknown) => void;

function pointSelectionMap() {
  const listeners = new Map<string, Listener[]>();
  const fake = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    once(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    remove: vi.fn(),
    getCanvas: () => undefined,
    emit(event: string, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
  return fake;
}

describe("MapLibre point selection", () => {
  it("publishes the geographic point of a map tap while selection is active", () => {
    const map = pointSelectionMap();
    const renderer = createMapLibreRenderer({
      createMap: (_options: MapOptions) => map as unknown as MapLibreMap,
    });
    const selected = vi.fn();
    const unsubscribe = renderer.subscribePointSelection?.(selected);

    renderer.mount(document.createElement("div"));
    map.emit("click", {
      point: { x: 100, y: 200 },
      lngLat: { lng: 30.5234, lat: 50.4501 },
    });

    expect(selected).toHaveBeenCalledOnce();
    expect(selected).toHaveBeenCalledWith({
      longitude: 30.5234,
      latitude: 50.4501,
    });

    unsubscribe?.();
    renderer.unmount();
  });

  it("ignores invalid geographic coordinates", () => {
    const map = pointSelectionMap();
    const renderer = createMapLibreRenderer({
      createMap: (_options: MapOptions) => map as unknown as MapLibreMap,
    });
    const selected = vi.fn();
    const unsubscribe = renderer.subscribePointSelection?.(selected);

    renderer.mount(document.createElement("div"));
    map.emit("click", {
      point: { x: 100, y: 200 },
      lngLat: { lng: 30.5234, lat: 91 },
    });

    expect(selected).not.toHaveBeenCalled();

    unsubscribe?.();
    renderer.unmount();
  });

  it("keeps the editor marker distinct from observed-position presentation", () => {
    const map = pointSelectionMap();
    const marker: MapLabelMarker = {
      setLngLat: vi.fn(),
      remove: vi.fn(),
    };
    const createSelectionMarker = vi.fn(() => marker);
    const renderer = createMapLibreRenderer({
      createMap: (_options: MapOptions) => map as unknown as MapLibreMap,
      createSelectionMarker,
    });

    renderer.mount(document.createElement("div"));
    renderer.setSelectionPoint?.({ longitude: 2.3522, latitude: 48.8566 });

    expect(createSelectionMarker).toHaveBeenCalledWith(map, [2.3522, 48.8566]);

    renderer.setSelectionPoint?.(null);
    expect(marker.remove).toHaveBeenCalledOnce();
    renderer.unmount();
  });
});
