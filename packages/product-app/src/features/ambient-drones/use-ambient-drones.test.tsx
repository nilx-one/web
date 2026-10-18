// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapCameraChange,
  MapRenderer,
  SystemDroneHandle,
} from "@nilx-one/map-contract";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AMBIENT_MIN_ZOOM, dronesAround } from "./ambient-drone-schedule";
import { useAmbientDrones } from "./use-ambient-drones";

const CENTRE: readonly [number, number] = [30.4505, 50.4745];

function fakeRenderer(zoom: number) {
  let camera: MapCamera = { center: CENTRE, zoom, bearing: 0, pitch: 50 };
  const cameraListeners = new Set<(change: MapCameraChange) => void>();
  const shown = new Map<string, SystemDroneHandle>();
  const upsert = vi.fn((handle: SystemDroneHandle) => {
    shown.set(handle.id, handle);
    return true;
  });
  const remove = vi.fn((id: string) => {
    shown.delete(id);
  });
  const roadsWithin = vi.fn(() => []);
  const renderer = {
    systemDrone: { upsert, remove },
    getCamera: () => camera,
    subscribeCamera: (listener: (change: MapCameraChange) => void) => {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    roadsWithin,
  } as unknown as MapRenderer;
  return {
    renderer,
    shown,
    upsert,
    roadsWithin,
    moveCamera(next: Partial<MapCamera>) {
      camera = { ...camera, ...next };
      for (const listener of cameraListeners)
        listener({ camera, gesture: true });
    },
  };
}

function World(props: {
  renderer: MapRenderer;
  ready?: boolean;
  suspended?: boolean;
  clock: () => number;
}) {
  useAmbientDrones({ ready: true, ...props });
  return null;
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let clockMs = 1_800_000_000_000;
const clock = () => clockMs;

/** Runs the frames requested so far, as the browser would once per paint. */
function paint(times = 1) {
  for (let index = 0; index < times; index++) {
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(performance.now());
    });
  }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  frames = new Map();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  setVisibility("visible");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ambient drones", () => {
  it("fly around the camera at street zoom, a couple of new legs a frame", () => {
    const fake = fakeRenderer(17);
    const expected = dronesAround(CENTRE, 1_400).length;
    render(<World renderer={fake.renderer} clock={clock} />);
    paint();
    expect(fake.shown.size).toBeGreaterThan(0);
    expect(fake.shown.size).toBeLessThanOrEqual(2);
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(2);
    expect(fake.shown.size).toBeLessThanOrEqual(expected);
    for (const handle of fake.shown.values()) {
      expect(handle.id).toMatch(/^ambient:/);
      expect(["street", "yard"]).toContain(handle.kind);
      expect(handle.scale).toBeGreaterThan(1);
    }
  });

  it("are where the clock says, moving on between frames", () => {
    const fake = fakeRenderer(17);
    render(<World renderer={fake.renderer} clock={clock} />);
    paint(10);
    const before = new Map(
      [...fake.shown].map(([id, handle]) => [id, handle.lngLat]),
    );
    clockMs += 10_000;
    paint();
    const moved = [...fake.shown].filter(
      ([id, handle]) => before.get(id)?.join() !== handle.lngLat.join(),
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it("request nothing and draw nothing zoomed out past street scale", () => {
    const fake = fakeRenderer(AMBIENT_MIN_ZOOM - 1);
    render(<World renderer={fake.renderer} clock={clock} />);
    expect(frames.size).toBe(0);
    expect(fake.upsert).not.toHaveBeenCalled();
    expect(fake.roadsWithin).not.toHaveBeenCalled();
    // Zooming in wakes them; zooming out again takes them off and stops.
    act(() => fake.moveCamera({ zoom: 17 }));
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(0);
    act(() => fake.moveCamera({ zoom: 14 }));
    paint();
    expect(fake.shown.size).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("stop while the page is hidden and pick up where the clock is", () => {
    const fake = fakeRenderer(17);
    render(<World renderer={fake.renderer} clock={clock} />);
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(0);
    // Off at once, without waiting for a frame a background page never gets.
    setVisibility("hidden");
    expect(fake.shown.size).toBe(0);
    expect(frames.size).toBe(0);
    const calls = fake.upsert.mock.calls.length;
    clockMs += 3_600_000;
    paint(3);
    expect(fake.upsert.mock.calls.length).toBe(calls);
    setVisibility("visible");
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(0);
  });

  it("stay off while suspended, for reduced motion, and when unmounted", () => {
    const suspended = fakeRenderer(17);
    render(<World renderer={suspended.renderer} suspended clock={clock} />);
    paint(3);
    expect(suspended.upsert).not.toHaveBeenCalled();

    const matchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as never;
    const reduced = fakeRenderer(17);
    render(<World renderer={reduced.renderer} clock={clock} />);
    paint(3);
    expect(reduced.upsert).not.toHaveBeenCalled();
    window.matchMedia = matchMedia;

    const mounted = fakeRenderer(17);
    const view = render(<World renderer={mounted.renderer} clock={clock} />);
    paint(10);
    expect(mounted.shown.size).toBeGreaterThan(0);
    view.unmount();
    expect(mounted.shown.size).toBe(0);
    expect(frames.size).toBe(0);
  });

  it("wait a moment for their roads to be read ahead, once per area", async () => {
    const fake = fakeRenderer(17);
    let finish: () => void = () => undefined;
    const preloadRoads = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({});
        }),
    );
    Object.assign(fake.renderer, { preloadRoads });
    render(<World renderer={fake.renderer} clock={clock} />);
    paint(5);
    expect(fake.shown.size).toBe(0);
    expect(preloadRoads).toHaveBeenCalledOnce();
    await act(async () => finish());
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(0);
    expect(preloadRoads).toHaveBeenCalledOnce();
  });

  it("fly without the roads they waited for too long", () => {
    const fake = fakeRenderer(17);
    Object.assign(fake.renderer, {
      preloadRoads: vi.fn(() => new Promise(() => undefined)),
    });
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    render(<World renderer={fake.renderer} clock={clock} />);
    paint(5);
    expect(fake.shown.size).toBe(0);
    now += 3_000;
    paint(10);
    expect(fake.shown.size).toBeGreaterThan(0);
  });

  it("take themselves off when the renderer cannot draw them", () => {
    const fake = fakeRenderer(17);
    fake.upsert.mockImplementation(() => {
      throw new Error("lost context");
    });
    render(<World renderer={fake.renderer} clock={clock} />);
    paint(3);
    expect(frames.size).toBe(0);
  });
});
