// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapCamera, SystemDroneHandle } from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import { FLYOVER_LANE_METERS } from "./flyover-flight";
import {
  FLYOVER_ARRIVAL_MS,
  FLYOVER_DRONE_ID,
  FLYOVER_TAKEOFF_MS,
  chaseCamera,
  routeOverview,
  useFlyover,
} from "./use-flyover";

/** About 330 m due east, so a whole flight fits in a test. */
const FROM = { longitude: 30.4467, latitude: 50.4734 };
const TO = { longitude: 30.4513, latitude: 50.4734 };
const BASE: MapCamera = {
  center: [30.4467, 50.4734],
  zoom: 19,
  bearing: 10,
  pitch: 50,
};

function setup() {
  const double = createMapRendererDouble();
  double.setCamera(BASE);
  vi.mocked(double.setCamera).mockClear();
  const drone = {
    upsert: vi.fn((_handle: SystemDroneHandle) => true),
    remove: vi.fn(),
  };
  const renderer = {
    ...double,
    systemDrone: drone,
    setRoute: vi.fn(),
    obstaclesWithin: vi.fn(() => []),
    roadsWithin: vi.fn(() => []),
    preloadRoads: vi.fn(async () => ({
      covering: 0,
      refused: 0,
      skipped: 0,
      cached: 0,
      fetched: 0,
      failed: 0,
    })),
  };
  const hook = renderHook(() => useFlyover(renderer, true));
  return { renderer, drone, hook };
}

async function begin(hook: ReturnType<typeof setup>["hook"]) {
  await act(async () => {
    hook.result.current.start({ from: FROM, to: TO });
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function lastDrone(drone: ReturnType<typeof setup>["drone"]) {
  return drone.upsert.mock.lastCall?.[0];
}

function reduceMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduce })),
  );
  window.matchMedia = globalThis.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  reduceMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useFlyover", () => {
  it("draws the route, takes off beside the Bond and flies it", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    expect(hook.result.current.active).toBe(true);
    expect(renderer.preloadRoads).toHaveBeenCalledOnce();
    expect(renderer.setRoute).toHaveBeenLastCalledWith({
      points: [
        [FROM.longitude, FROM.latitude],
        [TO.longitude, TO.latitude],
      ],
    });
    act(() => vi.advanceTimersByTime(32));
    expect(lastDrone(drone)).toMatchObject({
      id: FLYOVER_DRONE_ID,
      lngLat: [FROM.longitude, FROM.latitude],
    });
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 2_000));
    const flying = lastDrone(drone)!;
    expect(flying.lngLat[0]).toBeGreaterThan(FROM.longitude);
    expect(flying.heightMeters).toBeGreaterThan(5);
    expect(flying.bearingDeg).toBeCloseTo(90, 0);
    // The chase camera looks the way xPing flies, from behind it.
    const camera = renderer.getCamera();
    expect(camera.bearing).toBeGreaterThan(60);
    expect(camera.center[0]).toBeGreaterThan(flying.lngLat[0]);
  });

  it("steps aside on the arrow keys and is pulled back to the route", async () => {
    const { drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "ArrowRight", cancelable: true }),
      );
    });
    act(() => vi.advanceTimersByTime(900));
    // Flying east, its right is the south.
    const aside = lastDrone(drone)!;
    const metersSouth = (FROM.latitude - aside.lngLat[1]) * 111_195;
    expect(metersSouth).toBeGreaterThan(FLYOVER_LANE_METERS * 0.6);
    act(() => vi.advanceTimersByTime(2_500));
    const back = lastDrone(drone)!;
    expect(Math.abs(FROM.latitude - back.lngLat[1]) * 111_195).toBeLessThan(2);
  });

  it("hovers at the station, then puts the world back", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 12_000));
    const hovering = lastDrone(drone)!;
    expect(hovering.lngLat[0]).toBeCloseTo(TO.longitude, 5);
    expect(hook.result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(FLYOVER_ARRIVAL_MS));
    expect(hook.result.current.active).toBe(false);
    expect(drone.remove).toHaveBeenCalledWith(FLYOVER_DRONE_ID);
    expect(renderer.setRoute).toHaveBeenLastCalledWith(null);
    expect(renderer.setCamera).toHaveBeenLastCalledWith(
      BASE,
      expect.objectContaining({ motion: "eased" }),
    );
  });

  it("can be left at any moment, with Escape too", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 1_000));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Escape", cancelable: true }),
      );
    });
    expect(hook.result.current.active).toBe(false);
    expect(drone.remove).toHaveBeenCalledWith(FLYOVER_DRONE_ID);
    expect(renderer.setRoute).toHaveBeenLastCalledWith(null);
    drone.upsert.mockClear();
    act(() => vi.advanceTimersByTime(5_000));
    expect(drone.upsert).not.toHaveBeenCalled();
  });

  it("shows the whole route still under reduced motion", async () => {
    reduceMotion(true);
    const { renderer, drone, hook } = setup();
    await begin(hook);
    expect(renderer.getCamera()).toEqual(
      routeOverview([
        [FROM.longitude, FROM.latitude],
        [TO.longitude, TO.latitude],
      ]),
    );
    expect(lastDrone(drone)).toMatchObject({
      lngLat: [TO.longitude, TO.latitude],
      reducedMotion: true,
    });
    drone.upsert.mockClear();
    act(() => vi.advanceTimersByTime(5_000));
    expect(drone.upsert).not.toHaveBeenCalled();
    act(() => hook.result.current.leave());
    expect(hook.result.current.active).toBe(false);
  });
});

describe("chaseCamera", () => {
  it("stands back further the higher xPing flies", () => {
    const low = chaseCamera(FROM, 90, 10);
    const high = chaseCamera(FROM, 90, 60);
    expect(low.bearing).toBe(90);
    expect(high.zoom).toBeLessThan(low.zoom);
    expect(low.center[0]).toBeGreaterThan(FROM.longitude);
  });
});
