// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCapability } from "@nilx-one/host-contract";
import type {
  MapCamera,
  MapFogCell,
  MapFogField,
  MapObstacle,
  MapPointSelection,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import {
  AMBIENCE_FAR_ZOOM,
  AMBIENCE_NEAR_ZOOM,
  AMBIENCE_SETTLE_MS,
  useWorldAmbience,
  worldAmbience,
} from "./world-ambience";

const CENTER = { longitude: 30.5234, latitude: 50.4501 };

function camera(zoom = AMBIENCE_NEAR_ZOOM): MapCamera {
  return {
    center: [CENTER.longitude, CENTER.latitude],
    zoom,
    bearing: 0,
    pitch: 0,
  };
}

/** A box of ground in degrees off the middle of the view. */
function box(
  west: number,
  south: number,
  east: number,
  north: number,
): MapObstacle["polygons"][number] {
  return [
    [
      [CENTER.longitude + west, CENTER.latitude + south],
      [CENTER.longitude + east, CENTER.latitude + south],
      [CENTER.longitude + east, CENTER.latitude + north],
      [CENTER.longitude + west, CENTER.latitude + north],
      [CENTER.longitude + west, CENTER.latitude + south],
    ],
  ];
}

const EVERYWHERE = box(-1, -1, 1, 1);

/** Fog cut in two along the middle of the view: east revealed, west not. */
function halfFog(active = true): MapFogField {
  const cellAt = (point: MapPointSelection): MapFogCell => ({
    id: point.longitude >= CENTER.longitude ? "east" : "west",
    center: point,
    boundary: [],
  });
  return {
    isActive: () => active,
    cellAt,
    isRevealed: (id) => id === "east",
    frontier: () => [],
    reveal: () => undefined,
    subscribe: () => () => undefined,
  };
}

function soundDouble() {
  return {
    supported: true,
    play: vi.fn(),
    setEnabled: vi.fn(),
    setAmbience: vi.fn(),
    speak: vi.fn(),
  } satisfies SoundCapability;
}

describe("worldAmbience", () => {
  it("is silent while the view is a city rather than a place", () => {
    const ambience = worldAmbience(
      { obstaclesWithin: () => [{ kind: "water", polygons: [EVERYWHERE] }] },
      camera(AMBIENCE_FAR_ZOOM),
    );
    expect(ambience.presence).toBe(0);
    expect(ambience.water).toBe(0);
  });

  it("comes closer as the view zooms in", () => {
    const halfway = worldAmbience(
      {},
      camera((AMBIENCE_FAR_ZOOM + AMBIENCE_NEAR_ZOOM) / 2),
    );
    const close = worldAmbience({}, camera(AMBIENCE_NEAR_ZOOM + 2));
    expect(halfway.presence).toBeCloseTo(0.5);
    expect(close.presence).toBe(1);
  });

  it("hears water and streets in what the basemap paints", () => {
    const shore = worldAmbience(
      { obstaclesWithin: () => [{ kind: "water", polygons: [EVERYWHERE] }] },
      camera(),
    );
    expect(shore.water).toBe(1);
    expect(shore.city).toBe(0);

    // A building over the eastern fifth of the listened square.
    const street = worldAmbience(
      {
        obstaclesWithin: () => [
          { kind: "building", polygons: [box(0.001, -1, 1, 1)] },
        ],
      },
      camera(),
    );
    expect(street.water).toBe(0);
    expect(street.city).toBeGreaterThan(0.2);
    expect(street.city).toBeLessThan(1);
  });

  it("treats a courtyard inside a block as open ground", () => {
    // An outline around everything, with a hole wider than what is heard.
    const block = [...box(-1, -1, 1, 1), ...box(-0.01, -0.01, 0.01, 0.01)];
    const ambience = worldAmbience(
      { obstaclesWithin: () => [{ kind: "building", polygons: [block] }] },
      camera(),
    );
    expect(ambience.city).toBe(0);
  });

  it("is clear where no fog is drawn, and muffled by the fog that is", () => {
    expect(worldAmbience({}, camera()).clarity).toBe(1);
    expect(worldAmbience({ fog: halfFog(false) }, camera()).clarity).toBe(1);
    const half = worldAmbience({ fog: halfFog() }, camera()).clarity;
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
  });
});

describe("useWorldAmbience", () => {
  afterEach(() => vi.useRealTimers());

  it("asks for nothing while the person has not asked for the world", () => {
    const sound = soundDouble();
    const renderer = createMapRendererDouble();
    renderHook(() => useWorldAmbience({ renderer, sound, enabled: false }));
    expect(sound.setAmbience).not.toHaveBeenCalled();
    expect(renderer.subscribeCamera).not.toHaveBeenCalled();
  });

  it("listens again once the camera settles, and fades out when it is gone", () => {
    vi.useFakeTimers();
    const sound = soundDouble();
    const renderer = createMapRendererDouble();
    const { unmount } = renderHook(() =>
      useWorldAmbience({ renderer, sound, enabled: true }),
    );
    expect(sound.setAmbience).toHaveBeenCalledOnce();

    act(() => {
      renderer.moveCamera(camera(AMBIENCE_FAR_ZOOM), true);
      renderer.moveCamera(camera(AMBIENCE_FAR_ZOOM), true);
    });
    expect(sound.setAmbience).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(AMBIENCE_SETTLE_MS));
    expect(sound.setAmbience).toHaveBeenCalledTimes(2);
    expect(sound.setAmbience).toHaveBeenLastCalledWith(
      expect.objectContaining({ presence: 0 }),
    );

    unmount();
    expect(sound.setAmbience).toHaveBeenLastCalledWith(null);
  });
});
