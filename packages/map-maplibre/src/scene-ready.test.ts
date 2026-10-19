// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";
import { waitForScene } from "./scene-ready";

function scene() {
  const listeners = new Map<string, Set<() => void>>();
  const state = {
    style: true,
    tiles: false,
    moving: false,
    assets: false,
    longitude: 30,
  };
  const map = {
    on: (event: string, listener: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: () => void) =>
      listeners.get(event)?.delete(listener),
    triggerRepaint: vi.fn(),
    getCenter: () => ({ lng: state.longitude, lat: 50 }),
    getZoom: () => 18.5,
    getBearing: () => 45,
    getPitch: () => 50,
    getPadding: () => ({ top: 88, right: 16, bottom: 232, left: 16 }),
    isStyleLoaded: () => state.style,
    areTilesLoaded: () => state.tiles,
    isMoving: () => state.moving,
  };
  const emit = (event = "render") => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return { state, map: map as unknown as MapLibreMap, emit, listeners };
}

describe("initial scene paint barrier", () => {
  it("allows subpixel tracking of an autonomous moving driver", async () => {
    const s = scene();
    Object.assign(s.state, { tiles: true, assets: true });
    const waiting = waitForScene(
      s.map,
      () => true,
      new AbortController().signal,
    );
    s.emit();
    s.state.longitude += 0.0000001;
    s.emit();
    await waiting;
    expect(s.listeners.get("render")?.size).toBe(0);
  });
  it.each(["tiles", "assets"] as const)(
    "waits when %s is the last resource, then observes two paints without idle",
    async (last) => {
      const s = scene();
      const done = vi.fn();
      const waiting = waitForScene(
        s.map,
        () => s.state.assets,
        new AbortController().signal,
      ).then(done);
      s.state[last === "tiles" ? "assets" : "tiles"] = true;
      s.emit();
      s.emit();
      await Promise.resolve();
      expect(done).not.toHaveBeenCalled();
      s.state[last] = true;
      s.emit();
      await Promise.resolve();
      expect(done).not.toHaveBeenCalled();
      s.emit();
      await waiting;
      expect(done).toHaveBeenCalledOnce();
      expect(s.listeners.get("render")?.size).toBe(0);
    },
  );

  it("does not reveal a completed flight before final framing/terrain tiles settle", async () => {
    const s = scene();
    const done = vi.fn();
    Object.assign(s.state, { tiles: true, assets: true, moving: true });
    const waiting = waitForScene(
      s.map,
      () => s.state.assets,
      new AbortController().signal,
    ).then(done);
    s.emit();
    s.emit();
    s.state.moving = false;
    s.emit();
    s.state.longitude += 0.001;
    s.emit();
    s.state.tiles = false;
    s.emit();
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    s.state.tiles = true;
    s.emit();
    s.emit();
    await waiting;
    expect(done).toHaveBeenCalledOnce();
  });

  it("aborts and removes listeners so a stale paint cannot reveal a retried scene", async () => {
    const s = scene();
    const controller = new AbortController();
    const waiting = waitForScene(
      s.map,
      () => s.state.assets,
      controller.signal,
    );
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(s.listeners.get("render")?.size).toBe(0);
    expect(s.listeners.get("remove")?.size).toBe(0);
  });

  it("rejects a removed map instead of waiting on a dead renderer", async () => {
    const s = scene();
    const waiting = waitForScene(
      s.map,
      () => false,
      new AbortController().signal,
    );
    s.emit("remove");
    await expect(waiting).rejects.toThrow("Map removed");
  });
});
