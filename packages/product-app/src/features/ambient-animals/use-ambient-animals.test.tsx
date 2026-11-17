// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapCameraChange,
  MapRenderer,
} from "@nilx-one/map-contract";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { offsetMeters } from "../ambient-drones/ambient-drone-schedule";
import { ANIMAL_MIN_ZOOM } from "./ambient-animal-schedule";
import {
  RESELECT_AT_REST_MS,
  RESELECT_METERS,
  useAmbientAnimals,
} from "./use-ambient-animals";

const CENTRE: readonly [number, number] = [30.4505, 50.4745];

function fakeRenderer() {
  let camera: MapCamera = {
    center: CENTRE,
    zoom: ANIMAL_MIN_ZOOM,
    bearing: 0,
    pitch: 50,
  };
  const cameraListeners = new Set<(change: MapCameraChange) => void>();
  const tileListeners = new Set<() => void>();
  const fogListeners = new Set<() => void>();
  // One read of the ground asks for its obstacles once.
  const obstaclesWithin = vi.fn(() => []);
  const renderer = {
    animals: { upsert: vi.fn(() => true), remove: vi.fn() },
    getCamera: () => camera,
    subscribeCamera: (listener: (change: MapCameraChange) => void) => {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    },
    subscribeLandmarksChanged: (listener: () => void) => {
      tileListeners.add(listener);
      return () => tileListeners.delete(listener);
    },
    fog: {
      isActive: () => false,
      subscribe: (listener: () => void) => {
        fogListeners.add(listener);
        return () => fogListeners.delete(listener);
      },
    },
    obstaclesWithin,
    greenAreasWithin: () => [],
    roadsWithin: () => [],
  } as unknown as MapRenderer;
  return {
    renderer,
    groundReads: () => obstaclesWithin.mock.calls.length,
    moveCamera(meters: number) {
      camera = { ...camera, center: offsetMeters(camera.center, meters, 0) };
      for (const listener of cameraListeners)
        listener({ camera, gesture: true });
    },
    tilesArrive() {
      for (const listener of tileListeners) listener();
    },
    fogLifts() {
      for (const listener of fogListeners) listener();
    },
  };
}

function World({ renderer }: { renderer: MapRenderer }) {
  useAmbientAnimals({ renderer, ready: true });
  return null;
}

let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
let nowMs = 0;

/** Paints at 60 frames a second for this long, as a view at rest does. */
function paintFor(ms: number) {
  const until = nowMs + ms;
  while (nowMs < until) {
    nowMs += 1000 / 60;
    const pending = [...frames.values()];
    frames.clear();
    act(() => {
      for (const callback of pending) callback(nowMs);
    });
  }
}

beforeEach(() => {
  frames = new Map();
  nowMs = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    nextFrame += 1;
    frames.set(nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ambient animals", () => {
  it("read the ground once for a camera that stands still", () => {
    const fake = fakeRenderer();
    render(<World renderer={fake.renderer} />);

    paintFor(RESELECT_AT_REST_MS - 1_000);

    expect(fake.groundReads()).toBe(1);
  });

  it("read it again at rest only once in a long while", () => {
    const fake = fakeRenderer();
    render(<World renderer={fake.renderer} />);

    paintFor(RESELECT_AT_REST_MS * 3 + 1_000);

    expect(fake.groundReads()).toBe(4);
  });

  it("read it again once the camera has moved on, not for a nudge", () => {
    const fake = fakeRenderer();
    render(<World renderer={fake.renderer} />);
    paintFor(2_000);

    act(() => fake.moveCamera(RESELECT_METERS / 4));
    paintFor(2_000);
    expect(fake.groundReads()).toBe(1);

    act(() => fake.moveCamera(RESELECT_METERS));
    paintFor(2_000);
    expect(fake.groundReads()).toBe(2);
  });

  it("read it again when tiles arrive or fog lifts", () => {
    const fake = fakeRenderer();
    render(<World renderer={fake.renderer} />);
    paintFor(2_000);

    act(() => fake.tilesArrive());
    paintFor(100);
    expect(fake.groundReads()).toBe(2);

    // Tiles that keep arriving are read at most once a second.
    act(() => fake.tilesArrive());
    paintFor(100);
    expect(fake.groundReads()).toBe(2);
    paintFor(1_000);
    expect(fake.groundReads()).toBe(3);
    paintFor(2_000);

    act(() => fake.fogLifts());
    paintFor(2_000);
    expect(fake.groundReads()).toBe(4);
  });
});
