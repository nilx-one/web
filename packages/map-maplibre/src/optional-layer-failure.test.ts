// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

// Both optional layers' code is gone: offline, or a hashed chunk a newer
// deploy no longer serves.
vi.mock("./avatar-layer", () => {
  throw new Error("avatar-layer chunk is gone");
});
vi.mock("./monument-layer", () => {
  throw new Error("monument-layer chunk is gone");
});

import { createMapLibreRenderer } from "./index";

/** A map that is loaded, at rest and painting; anything else is a no-op. */
function settledMap() {
  const listeners = new Map<string, Set<(payload?: unknown) => void>>();
  const known = {
    on(event: string, listener: (payload?: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return proxy;
    },
    once(event: string, listener: (payload?: unknown) => void) {
      const once = (payload?: unknown) => {
        listeners.get(event)?.delete(once);
        listener(payload);
      };
      return known.on(event, once);
    },
    off(event: string, listener: (payload?: unknown) => void) {
      listeners.get(event)?.delete(listener);
      return proxy;
    },
    getCenter: () => ({ lng: 30.5234, lat: 50.4501 }),
    getZoom: () => 18.5,
    getBearing: () => 0,
    getPitch: () => 50,
    getPadding: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
    isStyleLoaded: () => true,
    areTilesLoaded: () => true,
    isMoving: () => false,
    getLayer: () => undefined,
    getSource: () => undefined,
    // The renderer asks for a repaint; a real map would paint next frame.
    triggerRepaint: () => setTimeout(() => emit("render"), 4),
  };
  const emit = (event: string, payload?: unknown) => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
  };
  const proxy: MapLibreMap = new Proxy(known, {
    get: (target, property) =>
      property in target
        ? target[property as keyof typeof target]
        : () => undefined,
  }) as unknown as MapLibreMap;
  return { map: proxy, emit };
}

describe("optional layers whose code cannot load", () => {
  it("still let the opening scene reveal, without the bodies or the monument", async () => {
    const fake = settledMap();
    const renderer = createMapLibreRenderer({ createMap: () => fake.map });
    renderer.mount(document.createElement("div"));
    fake.emit("load");
    // The signed-in body asks for the avatar layer, whose import fails.
    renderer.avatars.upsert({
      id: "bond",
      modelId: "sky-study",
      lngLat: [30.5234, 50.4501],
      bearingDeg: 0,
      clipId: "idle",
      clipPhase: 0,
      scale: 1,
      visible: true,
    });
    // Let both rejected imports settle.
    await vi.waitFor(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const controller = new AbortController();
    const ready = renderer.whenSceneReady!(controller.signal);
    const outcome = await Promise.race([
      ready.then(
        () => "revealed",
        () => "aborted",
      ),
      new Promise((resolve) => setTimeout(() => resolve("still covered"), 500)),
    ]);
    controller.abort();
    expect(outcome).toBe("revealed");
  });
});
