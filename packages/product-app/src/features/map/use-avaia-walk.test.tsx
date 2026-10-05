// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapBounds,
  type MapFogField,
  type MapGroundTap,
  type MapPointSelection,
  type MapRenderer,
  type MapRoad,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OUTING_INTERVAL_MS,
  POINT_B_STAND_MS,
  RESTLESS_MS,
  WANDER_MAX_METERS,
  WANDER_MIN_METERS,
} from "./outing-drive";
import { useAvaiaWalk, type AvaiaWalkInput } from "./use-avaia-walk";
import { readWorldMemory } from "./world-memory";

const ORIGIN = { longitude: 30.5234, latitude: 50.4501 };
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN.latitude * Math.PI) / 180);
const at = (x: number, y: number): MapPointSelection => ({
  longitude: ORIGIN.longitude + x * M_LON,
  latitude: ORIGIN.latitude + y * M_LAT,
});

/** A renderer with one long footway east of the origin, and taps on demand. */
function walkRenderer() {
  let listener: ((tap: MapGroundTap) => void) | undefined;
  const footway: MapRoad = {
    kind: "path",
    kindDetail: "footway",
    lines: [
      [0, 100, 200, 300, 400, 500, 600].map((x) => {
        const p = at(x, 0);
        return [p.longitude, p.latitude] as [number, number];
      }),
    ],
  };
  const renderer = {
    subscribeGroundTap: (next: (tap: MapGroundTap) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    roadsWithin: () => [footway],
    obstaclesWithin: () => [],
  } as unknown as MapRenderer;
  return {
    renderer,
    tap: (point: MapPointSelection) =>
      act(() => listener?.({ ...point, ground: "open" })),
  };
}

function render(renderer: MapRenderer) {
  return renderHook((props: AvaiaWalkInput) => useAvaiaWalk(props), {
    initialProps: {
      renderer,
      active: true,
      observed: { ...ORIGIN, accuracyMeters: 10 },
      model: undefined,
      locale: "en",
      avaiaAddress: "avaia:test",
      owner: "0x0sky",
      zoom: 17,
      reducedMotion: true,
    },
  });
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
      "performance",
    ],
  });
  vi.setSystemTime(new Date(2026, 9, 3, 13, 0, 0));
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an Avaia sent to a point B", () => {
  it("stands there looking around, then carries on from B", async () => {
    const { renderer, tap } = walkRenderer();
    const { result } = render(renderer);
    const b = at(300, 0);

    tap(b);
    await advance(1);
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    expect(mapDistanceMeters(standing!.point, b)).toBeLessThan(1);
    expect(result.current.moving).toBe(true);

    await advance(POINT_B_STAND_MS - 100);
    expect(result.current.stance(performance.now())?.clipId).toBe(
      "turn_in_place",
    );

    await advance(200);
    const after = result.current.stance(performance.now());
    expect(after?.clipId).toBeUndefined();
    expect(mapDistanceMeters(after!.point, b)).toBeLessThan(1);
    expect(result.current.moving).toBe(false);
  });

  it("lets a new tap during the stand walk on from where it stands", async () => {
    const { renderer, tap } = walkRenderer();
    const { result } = render(renderer);

    tap(at(300, 0));
    await advance(1_000);
    tap(at(500, 0));
    await advance(1);
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    expect(mapDistanceMeters(standing!.point, at(500, 0))).toBeLessThan(1);
  });
});

describe("an Avaia left idle", () => {
  it("wanders out once restless, and not again within the interval", async () => {
    const { renderer } = walkRenderer();
    const { result } = render(renderer);
    const start = at(0, 0);

    await advance(RESTLESS_MS - 1_000);
    expect(result.current.stance(performance.now())).toBeUndefined();

    await advance(2_000);
    const out = result.current.stance(performance.now());
    expect(out).toBeDefined();
    const meters = mapDistanceMeters(start, out!.point);
    expect(meters).toBeGreaterThanOrEqual(WANDER_MIN_METERS - 1);
    expect(meters).toBeLessThanOrEqual(WANDER_MAX_METERS + 1);
    expect(readWorldMemory("0x0sky").lastOutingAt).toBe(Date.now() - 1_000);

    // Restless again, but the interval is not up: it stays where it went.
    await advance(RESTLESS_MS * 2);
    expect(result.current.stance(performance.now())?.point).toEqual(out!.point);

    await advance(OUTING_INTERVAL_MS);
    expect(result.current.stance(performance.now())?.point).not.toEqual(
      out!.point,
    );
  });

  it("still goes out after leaving the wheel mid-stand and taking it back", async () => {
    const { renderer, tap } = walkRenderer();
    const { result } = render(renderer);
    tap(at(300, 0));
    await advance(1_000);
    act(() => result.current.reset());
    await advance(RESTLESS_MS + 1_000);
    await advance(1);
    const out = result.current.stance(performance.now());
    expect(out).toBeDefined();
    expect(out?.clipId).toBeUndefined();
    expect(mapDistanceMeters(at(0, 0), out!.point)).toBeGreaterThanOrEqual(
      WANDER_MIN_METERS - 1,
    );
    expect(readWorldMemory("0x0sky").lastOutingAt).toBeDefined();
  });

  it("does not go out while someone else is at the wheel", async () => {
    const { renderer } = walkRenderer();
    const { result, rerender } = render(renderer);
    rerender({
      renderer,
      active: false,
      observed: { ...ORIGIN, accuracyMeters: 10 },
      model: undefined,
      locale: "en",
      avaiaAddress: "avaia:test",
      owner: "0x0sky",
      zoom: 17,
      reducedMotion: true,
    });
    await advance(RESTLESS_MS * 2);
    expect(result.current.stance(performance.now())).toBeUndefined();
    expect(readWorldMemory("0x0sky").lastOutingAt).toBeUndefined();
  });
});

describe("an outing reading ahead", () => {
  /**
   * A renderer whose view holds no roads at all: the footway only exists once
   * `preloadRoads` has read it, and that read resolves when `release` is called.
   */
  function readAheadRenderer(fog?: MapFogField) {
    const { renderer: base, tap } = walkRenderer();
    const footway = base.roadsWithin!({
      west: -180,
      east: 180,
      south: -90,
      north: 90,
    });
    let loaded = false;
    let release: () => void = () => undefined;
    const preloadRoads = vi.fn(
      (_area: MapBounds, _accept?: (tile: MapBounds) => boolean) =>
        new Promise<{
          covering: number;
          refused: number;
          skipped: number;
          cached: number;
          fetched: number;
          failed: number;
        }>((resolve) => {
          release = () => {
            loaded = true;
            resolve({
              covering: 1,
              refused: 0,
              skipped: 0,
              cached: 0,
              fetched: 1,
              failed: 0,
            });
          };
        }),
    );
    const renderer = {
      ...base,
      roadsWithin: () => (loaded ? footway : []),
      preloadRoads,
      ...(fog === undefined ? {} : { fog }),
    } as unknown as MapRenderer;
    return { renderer, tap, preloadRoads, release: () => release() };
  }

  it("reads the outing's area ahead, then goes out along what it read", async () => {
    const { renderer, preloadRoads, release } = readAheadRenderer();
    const { result } = render(renderer);

    await advance(RESTLESS_MS + 1_000);
    expect(preloadRoads).toHaveBeenCalledTimes(1);
    const [area] = preloadRoads.mock.calls[0]!;
    // A there-and-back on a full charge: 2.5 km each way around the Avaia.
    const across = mapDistanceMeters(
      { longitude: area.west, latitude: ORIGIN.latitude },
      { longitude: area.east, latitude: ORIGIN.latitude },
    );
    expect(across).toBeGreaterThan(4_900);
    expect(across).toBeLessThan(5_100);
    expect(result.current.stance(performance.now())).toBeUndefined();

    release();
    await advance(1);
    const out = result.current.stance(performance.now());
    expect(out).toBeDefined();
    expect(mapDistanceMeters(at(0, 0), out!.point)).toBeGreaterThanOrEqual(
      WANDER_MIN_METERS - 1,
    );
  });

  it("gives up the outing when a tap comes while it is reading ahead", async () => {
    const { renderer, tap, release } = readAheadRenderer();
    const { result } = render(renderer);

    await advance(RESTLESS_MS + 1_000);
    tap(at(100, 0));
    release();
    await advance(1);
    const standing = result.current.stance(performance.now());
    expect(standing?.clipId).toBe("turn_in_place");
    expect(mapDistanceMeters(standing!.point, at(100, 0))).toBeLessThan(1);
    expect(readWorldMemory("0x0sky").lastOutingAt).toBeUndefined();
  });

  it("turns down tiles that are all fog", async () => {
    // Open within 600 m of the origin, fog everywhere else.
    const fog = {
      isActive: () => true,
      cellAt: (point: MapPointSelection) => ({
        id: mapDistanceMeters(point, ORIGIN) <= 600 ? "open" : "fog",
        center: point,
        boundary: [],
      }),
      isRevealed: (id: string) => id === "open",
      frontier: () => [],
      reveal: () => undefined,
      subscribe: () => () => undefined,
    } as unknown as MapFogField;
    const { renderer, preloadRoads } = readAheadRenderer(fog);
    render(renderer);

    await advance(RESTLESS_MS + 1_000);
    const [, accept] = preloadRoads.mock.calls[0]!;
    const box = (x: number, size = 100): MapBounds => {
      const a = at(x, 0);
      const b = at(x + size, size);
      return {
        west: a.longitude,
        east: b.longitude,
        south: a.latitude,
        north: b.latitude,
      };
    };
    expect(accept?.(box(0))).toBe(true);
    expect(accept?.(box(2_000))).toBe(false);
  });
});
