// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapGroundTap } from "@nilx-one/map-contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import { useBondManualWalk } from "./use-bond-manual-walk";

const here = { longitude: 30.5234, latitude: 50.4501 };
const there = { longitude: 30.5244, latitude: 50.4501 };

type TestRenderer = ReturnType<typeof createMapRendererDouble> & {
  tapGround(tap: MapGroundTap): void;
};

function tap(renderer: TestRenderer, ground: MapGroundTap["ground"] = "open") {
  act(() => renderer.tapGround({ ...there, ground }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("manual Bond walking", () => {
  function setup({
    declared = here,
    active = true,
    commit = vi.fn(async () => true),
  }: {
    declared?: typeof here | undefined;
    active?: boolean;
    commit?: (from: typeof here, to: typeof here) => Promise<boolean>;
  } = {}) {
    vi.useFakeTimers();
    const renderer = createMapRendererDouble({ kind: "ready" }) as TestRenderer;
    const hook = renderHook(() =>
      useBondManualWalk({
        renderer,
        owner: "0x0sky",
        declared,
        active,
        commit,
        zoom: 19,
      }),
    );
    return { ...hook, renderer, commit };
  }

  it("walks at Avaia speed and commits the declared location only on arrival", async () => {
    const { result, renderer, commit } = setup();
    tap(renderer);

    expect(result.current.moving).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(5_000));
    const halfway = result.current.point(performance.now())!;
    expect(halfway.longitude).toBeGreaterThan(here.longitude);
    expect(halfway.longitude).toBeLessThan(there.longitude);
    expect(commit).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(commit).toHaveBeenCalledExactlyOnceWith(here, there);
    expect(result.current.moving).toBe(false);
    expect(result.current.point(performance.now())).toEqual(there);
  });

  it("does not move for fog, buildings or water", () => {
    const { result, renderer, commit } = setup();
    for (const ground of ["fog", "building", "water"] as const) tap(renderer, ground);
    expect(result.current.moving).toBe(false);
    expect(result.current.point(performance.now())).toEqual(here);
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not listen when the wheel is Avaia's or location is live", () => {
    const inactive = setup({ active: false });
    tap(inactive.renderer);
    expect(inactive.result.current.moving).toBe(false);
    inactive.unmount();
    const live = setup({ declared: undefined });
    tap(live.renderer);
    expect(live.result.current.moving).toBe(false);
  });

  it("re-targets an interrupted walk from its current ground coordinate", async () => {
    const { result, renderer, commit } = setup();
    tap(renderer);
    act(() => vi.advanceTimersByTime(5_000));
    const from = result.current.point(performance.now())!;
    const target = { longitude: 30.5234, latitude: 50.4511 };
    act(() => renderer.tapGround({ ...target, ground: "open" }));
    expect(result.current.stance(performance.now())?.point).toEqual(from);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(commit).toHaveBeenCalledExactlyOnceWith(here, target);
  });

  it("rolls back a rejected server update to its last declared position", async () => {
    const commit = vi.fn(async () => false);
    const { result, renderer } = setup({ commit });
    tap(renderer);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));

    expect(result.current.failed).toBe(true);
    expect(result.current.point(performance.now())).toEqual(here);
    expect(commit).toHaveBeenCalledOnce();
  });
});
