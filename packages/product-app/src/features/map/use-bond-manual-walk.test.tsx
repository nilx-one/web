// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { quantizeDeclaredPoint } from "@nilx-one/host-contract";
import type { MapGroundTap } from "@nilx-one/map-contract";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import {
  useBondManualWalk,
  type ManualMoveOutcome,
} from "./use-bond-manual-walk";

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
  function setup(
    options: {
      declared?: typeof here | undefined;
      active?: boolean;
      commit?: (
        from: typeof here,
        to: typeof here,
      ) => Promise<ManualMoveOutcome>;
    } = {},
  ) {
    const declared = "declared" in options ? options.declared : here;
    const active = options.active ?? true;
    const commit =
      options.commit ?? vi.fn(async () => ({ kind: "accepted" as const }));
    vi.useFakeTimers();
    const renderer = createMapRendererDouble({ kind: "ready" }) as TestRenderer;
    const hook = renderHook(
      (props: { active: boolean; declared: typeof here | undefined }) =>
        useBondManualWalk({
          renderer,
          owner: "0x0sky",
          declared: props.declared,
          active: props.active,
          commit,
          zoom: 19,
        }),
      { initialProps: { active, declared } },
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
    expect(commit).toHaveBeenCalledOnce();
    const [from, arrived] = vi.mocked(commit).mock.calls[0]!;
    expect(from).toEqual(here);
    expect(arrived.longitude).toBeCloseTo(there.longitude, 6);
    expect(arrived.latitude).toBeCloseTo(there.latitude, 6);
    expect(result.current.moving).toBe(false);
    expect(result.current.point(performance.now())?.longitude).toBeCloseTo(
      there.longitude,
      6,
    );
  });

  it("commits an off-grid arrival snapped to the service's E7 grid", async () => {
    const { result, renderer, commit } = setup();
    const offGrid = { longitude: 30.52439876, latitude: 50.4501 };
    act(() => renderer.tapGround({ ...offGrid, ground: "open" }));
    await act(async () => vi.advanceTimersByTimeAsync(90_000));

    expect(commit).toHaveBeenCalledOnce();
    const [, arrived] = vi.mocked(commit).mock.calls[0]!;
    // The committed point is already on grid: quantizing it again is a no-op,
    // so the next move's compare-and-set cannot miss the stored coordinate.
    expect(quantizeDeclaredPoint(arrived)).toEqual(arrived);
    expect(arrived.longitude).toBeCloseTo(30.5243988, 7);
    // The hook now rests on that same canonical point.
    expect(result.current.point(performance.now())).toEqual(arrived);
  });

  it("does not move for fog, buildings or water", () => {
    const { result, renderer, commit } = setup();
    for (const ground of ["fog", "building", "water"] as const)
      tap(renderer, ground);
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
    expect(commit).toHaveBeenCalledOnce();
    const [origin, arrived] = vi.mocked(commit).mock.calls[0]!;
    expect(origin).toEqual(here);
    expect(arrived.longitude).toBeCloseTo(target.longitude, 6);
    expect(arrived.latitude).toBeCloseTo(target.latitude, 6);
  });

  it("rolls back a rejected server update to its last declared position", async () => {
    const commit = vi.fn(async () => ({ kind: "rejected" as const }));
    const { result, renderer } = setup({ commit });
    tap(renderer);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));

    expect(result.current.failed).toBe(true);
    expect(result.current.point(performance.now())).toEqual(here);
    expect(commit).toHaveBeenCalledOnce();
  });
  it("uses the server's position after a competing CAS write", async () => {
    const serverPosition = { longitude: 30.525, latitude: 50.4502 };
    const commit = vi.fn(
      async (
        _expected: typeof here,
        _target: typeof here,
      ): Promise<ManualMoveOutcome> => ({
        kind: "rejected",
        current: serverPosition,
      }),
    );
    const { result, renderer } = setup({ commit });
    tap(renderer);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(result.current.failed).toBe(true);
    expect(result.current.point(performance.now())).toEqual(serverPosition);

    // The next write expects the freshly read authoritative position.
    tap(renderer);
    await act(async () => vi.advanceTimersByTimeAsync(90_000));
    expect(commit.mock.calls[1]?.[0]).toEqual(serverPosition);
  });

  it("keeps a pending handover commit single-shot and rejects new taps", async () => {
    let resolveCommit: ((outcome: ManualMoveOutcome) => void) | undefined;
    const commit = vi.fn(
      () =>
        new Promise<ManualMoveOutcome>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const { result, renderer, rerender } = setup({ commit });
    tap(renderer);
    act(() => vi.advanceTimersByTime(5_000));
    act(() => result.current.stop());
    expect(commit).toHaveBeenCalledOnce();
    rerender({ active: false, declared: here });
    tap(renderer);
    expect(commit).toHaveBeenCalledOnce();
    await act(async () => {
      resolveCommit?.({ kind: "rejected" });
      await Promise.resolve();
    });
    expect(result.current.moving).toBe(false);
    expect(result.current.point(performance.now())).toEqual(here);
  });

  it("stops accepting manual taps after the host becomes live", () => {
    const { result, renderer, rerender, commit } = setup();
    tap(renderer);
    rerender({ active: true, declared: undefined });
    tap(renderer);
    expect(result.current.moving).toBe(false);
    expect(result.current.point(performance.now())).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
  });
});
