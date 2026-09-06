// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { GPUInitializationError, getWorkerUrl } from "maplibre-gl";
import type { Map as MapLibreMap, MapOptions } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapLibreRenderer } from "./index";

type FakeListener = (event: { readonly error?: unknown }) => void;

interface FakeMap {
  readonly on: (event: string, listener: FakeListener) => FakeMap;
  readonly once: (event: string, listener: FakeListener) => FakeMap;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly jumpTo: ReturnType<typeof vi.fn>;
  readonly setStyle: ReturnType<typeof vi.fn>;
  readonly getCanvas: () => HTMLCanvasElement;
  emit(event: string, error?: unknown): void;
}

function makeFakeMap(): FakeMap {
  const listeners = new Map<string, FakeListener[]>();
  const canvas = document.createElement("canvas");
  const remember = (event: string, listener: FakeListener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  };
  const fake: FakeMap = {
    on(event, listener) {
      remember(event, listener);
      return fake;
    },
    once(event, listener) {
      remember(event, listener);
      return fake;
    },
    remove: vi.fn(),
    jumpTo: vi.fn(),
    setStyle: vi.fn(),
    getCanvas: () => canvas,
    emit(event, error) {
      for (const listener of [...(listeners.get(event) ?? [])]) {
        listener({ error });
      }
    },
  };
  return fake;
}

function rendererFor(fakeMap: FakeMap, loadTimeoutMs = 50) {
  return createMapLibreRenderer({
    loadTimeoutMs,
    createMap: (_options: MapOptions) => fakeMap as unknown as MapLibreMap,
  });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("MapLibre renderer health invariants", () => {
  // The published worker is what an application build breaks: MapLibre resolves
  // it from its own module URL, which no bundled application chunk can answer,
  // and the map then stalls until the load timeout with no error of its own.
  it("binds a published worker url instead of MapLibre's module-relative default", () => {
    const renderer = rendererFor(makeFakeMap());

    renderer.mount(document.createElement("div"));

    expect(getWorkerUrl()).not.toBe("");
  });

  it("names the stalled phase when a style resolves but never paints", () => {
    vi.useFakeTimers();
    const fakeMap = makeFakeMap();
    const renderer = rendererFor(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("styledata");
    vi.advanceTimersByTime(50);

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "first-paint-timeout",
    });
  });

  it("turns a silent loading state into an explicit style timeout failure", () => {
    vi.useFakeTimers();
    const fakeMap = makeFakeMap();
    const renderer = rendererFor(fakeMap);

    renderer.mount(document.createElement("div"));
    vi.advanceTimersByTime(50);

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "style-load-timeout",
    });
  });

  it("reports a missing WebGL2 context as a client capability, not a missing style", () => {
    const fakeMap = makeFakeMap();
    const renderer = rendererFor(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("error", new GPUInitializationError({}, null));

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "webgl-unavailable",
    });
  });

  it("rejects a connected map surface that resolves to zero size", () => {
    const fakeMap = makeFakeMap();
    const renderer = rendererFor(fakeMap);
    const container = document.createElement("div");
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    document.body.append(container);

    renderer.mount(container);
    fakeMap.emit("load");

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "container-zero-size",
    });
  });

  it("surfaces a lost WebGL context after the map had rendered", () => {
    const fakeMap = makeFakeMap();
    const renderer = rendererFor(fakeMap);

    renderer.mount(document.createElement("div"));
    fakeMap.emit("load");
    fakeMap.getCanvas().dispatchEvent(new Event("webglcontextlost"));

    expect(renderer.getStatus()).toEqual({
      kind: "unavailable",
      reason: "webgl-context-lost",
    });
  });
});
