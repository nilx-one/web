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
  type FlyoverForcing,
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
const EXPLORED: MapCamera = {
  center: [30.459, 50.482],
  zoom: 16,
  bearing: 140,
  pitch: 20,
};

function setup(waitForRoads?: () => Promise<void>) {
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
    preloadRoads: vi.fn(async () => {
      await waitForRoads?.();
      return {
        covering: 0,
        refused: 0,
        skipped: 0,
        cached: 0,
        fetched: 0,
        failed: 0,
      };
    }),
  };
  const hook = renderHook(() => useFlyover(renderer, true));
  return { renderer, drone, hook };
}

async function begin(
  hook: ReturnType<typeof setup>["hook"],
  forcing?: FlyoverForcing,
) {
  await act(async () => {
    hook.result.current.start({
      from: FROM,
      to: TO,
      ...(forcing === undefined ? {} : { forcing }),
    });
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
    expect(hook.result.current.progress?.remainingMs).toBeGreaterThan(0);
    expect(hook.result.current.progress?.arrivedAt).toBeUndefined();
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

  it("hovers at the station, flies back to the start, then puts the world back", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 12_000));
    const hovering = lastDrone(drone)!;
    expect(hovering.lngLat[0]).toBeCloseTo(TO.longitude, 5);
    expect(hook.result.current.active).toBe(true);
    const arrivedAt = hook.result.current.progress?.arrivedAt;
    expect(arrivedAt).toBeDefined();
    // The way back is part of the flight, and cannot be forced.
    act(() => vi.advanceTimersByTime(FLYOVER_ARRIVAL_MS + 1_000));
    expect(hook.result.current.active).toBe(true);
    expect(hook.result.current.progress?.returning).toBe(true);
    expect(hook.result.current.progress?.arrivedAt).toBe(arrivedAt);
    act(() => vi.advanceTimersByTime(12_000));
    expect(lastDrone(drone)!.lngLat[0]).toBeCloseTo(FROM.longitude, 5);
    act(() => vi.advanceTimersByTime(FLYOVER_ARRIVAL_MS));
    expect(hook.result.current.active).toBe(false);
    expect(drone.remove).toHaveBeenCalledWith(FLYOVER_DRONE_ID);
    expect(renderer.setRoute).toHaveBeenLastCalledWith(null);
    expect(renderer.setCamera).toHaveBeenLastCalledWith(
      BASE,
      expect.objectContaining({ motion: "eased" }),
    );
  });

  it("forces only while held and allowed, straight at the station, and smokes", async () => {
    const { renderer, drone, hook } = setup();
    let allowed = false;
    const forcing = {
      allowed: vi.fn(() => allowed),
      spent: vi.fn(),
      wear: vi.fn(() => 0.4),
    };
    await begin(hook, forcing);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 200));
    act(() => hook.result.current.force(true));
    act(() => vi.advanceTimersByTime(500));
    // Held but not allowed: nothing spent, still on the roads.
    expect(forcing.spent).not.toHaveBeenCalled();
    expect(hook.result.current.progress?.forced).toBeUndefined();
    allowed = true;
    act(() => vi.advanceTimersByTime(1_000));
    expect(forcing.spent).toHaveBeenCalled();
    const spent = forcing.spent.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
    expect(spent).toBeGreaterThan(900);
    expect(spent).toBeLessThanOrEqual(1_000);
    expect(hook.result.current.progress?.forced).toBe(true);
    const road = vi.mocked(renderer.setRoute).mock.calls[0]?.[0];
    const straight = vi.mocked(renderer.setRoute).mock.lastCall?.[0];
    expect(straight).not.toBe(road);
    expect(straight?.points).toHaveLength(2);
    expect(straight?.points[1]).toEqual([TO.longitude, TO.latitude]);
    expect(lastDrone(drone)!.wear).toBe(0.4);
    // Let go: back on the roads, spending nothing more.
    act(() => hook.result.current.force(false));
    forcing.spent.mockClear();
    act(() => vi.advanceTimersByTime(500));
    expect(forcing.spent).not.toHaveBeenCalled();
    expect(hook.result.current.progress?.forced).toBeUndefined();
    expect(vi.mocked(renderer.setRoute).mock.lastCall?.[0]).toEqual(road);
  });

  it("can be cancelled at any moment", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 1_000));
    act(() => hook.result.current.leave());
    expect(hook.result.current.active).toBe(false);
    expect(drone.remove).toHaveBeenCalledWith(FLYOVER_DRONE_ID);
    expect(renderer.setRoute).toHaveBeenLastCalledWith(null);
    drone.upsert.mockClear();
    act(() => vi.advanceTimersByTime(5_000));
    expect(drone.upsert).not.toHaveBeenCalled();
  });

  it("keeps flying during an activity overview and resumes the same chase", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    const before = lastDrone(drone)!.lngLat[0];
    act(() => hook.result.current.setFollowing(false));
    renderer.setCamera(BASE);
    act(() => vi.advanceTimersByTime(1000));
    expect(renderer.getCamera()).toEqual(BASE);
    expect(lastDrone(drone)!.lngLat[0]).toBeGreaterThan(before);
    act(() => hook.result.current.setFollowing(true));
    act(() => vi.advanceTimersByTime(1000));
    expect(renderer.getCamera()).not.toEqual(BASE);
    expect(renderer.preloadRoads).toHaveBeenCalledOnce();
    act(() => hook.result.current.leave());
    expect(hook.result.current.progress).toBeUndefined();
  });

  it("keeps flying when collapsed and resumes chasing on expand", async () => {
    const { renderer, drone, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    const before = lastDrone(drone)!.lngLat[0];
    act(() => hook.result.current.collapse());
    expect(hook.result.current.expanded).toBe(false);
    expect(hook.result.current.active).toBe(true);
    expect(renderer.getCamera()).toEqual(BASE);
    renderer.setCamera(EXPLORED);
    act(() => vi.advanceTimersByTime(1000));
    expect(renderer.getCamera()).toEqual(EXPLORED);
    expect(lastDrone(drone)!.lngLat[0]).toBeGreaterThan(before);
    act(() => hook.result.current.expand());
    expect(hook.result.current.expanded).toBe(true);
    act(() => vi.advanceTimersByTime(250));
    expect(renderer.getCamera()).not.toEqual(EXPLORED);
    act(() => hook.result.current.collapse());
    expect(renderer.getCamera()).toEqual(EXPLORED);
  });

  it("retains the user's camera when a collapsed round trip finishes", async () => {
    const { renderer, hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    act(() => hook.result.current.collapse());
    renderer.setCamera(EXPLORED);
    act(() => vi.advanceTimersByTime(32_000));
    expect(hook.result.current.active).toBe(false);
    expect(renderer.getCamera()).toEqual(EXPLORED);
  });

  it("keeps the user's view when the flight is cancelled after collapse", async () => {
    const { renderer, hook } = setup();
    await begin(hook);
    act(() => hook.result.current.collapse());
    renderer.setCamera(EXPLORED);
    act(() => hook.result.current.leave());
    expect(hook.result.current.active).toBe(false);
    expect(renderer.getCamera()).toEqual(EXPLORED);
  });

  it("does not reclaim the camera when roads load after collapse", async () => {
    let finishRoads: () => void = () => {};
    const roads = new Promise<void>((resolve) => {
      finishRoads = resolve;
    });
    const { renderer, hook } = setup(() => roads);
    await begin(hook);
    act(() => hook.result.current.collapse());
    renderer.setCamera(EXPLORED);
    await act(async () => {
      finishRoads();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.getCamera()).toEqual(EXPLORED);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    expect(renderer.getCamera()).toEqual(EXPLORED);
    expect(hook.result.current.active).toBe(true);
    act(() => hook.result.current.leave());
    expect(renderer.getCamera()).toEqual(EXPLORED);
  });

  it("Escape collapses instead of cancelling the flight", async () => {
    const { hook } = setup();
    await begin(hook);
    act(() => vi.advanceTimersByTime(FLYOVER_TAKEOFF_MS + 500));
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Escape", cancelable: true }),
      );
    });
    expect(hook.result.current.active).toBe(true);
    expect(hook.result.current.expanded).toBe(false);
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
