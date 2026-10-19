// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorldStartup } from "./use-world-startup";

function renderer() {
  const waits: { signal: AbortSignal; resolve: () => void }[] = [];
  const whenSceneReady = vi.fn(
    (signal: AbortSignal) =>
      new Promise<void>((resolve) => waits.push({ signal, resolve })),
  );
  return {
    port: { whenSceneReady } as unknown as MapRenderer,
    waits,
    whenSceneReady,
  };
}
afterEach(() => vi.useRealTimers());

describe("world startup", () => {
  it("keeps the world covered while locating and until the renderer paints its final view", async () => {
    vi.useFakeTimers();
    const r = renderer();
    const { result, rerender } = renderHook(
      ({ locating }) =>
        useWorldStartup(r.port, { kind: "ready" }, locating, "target"),
      { initialProps: { locating: true } },
    );
    await act(async () => vi.advanceTimersByTime(32));
    expect(r.whenSceneReady).not.toHaveBeenCalled();
    rerender({ locating: false });
    await act(async () => vi.advanceTimersByTime(32));
    expect(result.current.ready).toBe(false);
    await act(async () => r.waits[0]!.resolve());
    expect(result.current.ready).toBe(true);
  });
  it("offers retry on timeout, ignores an old completion, and cleans up on unmount", async () => {
    vi.useFakeTimers();
    const r = renderer();
    const { result, unmount } = renderHook(() =>
      useWorldStartup(r.port, { kind: "ready" }, false, "target"),
    );
    await act(async () => vi.advanceTimersByTime(20_001));
    expect(result.current.failed).toBe(true);
    expect(r.waits[0]!.signal.aborted).toBe(true);
    await act(async () => r.waits[0]!.resolve());
    expect(result.current.ready).toBe(false);
    act(() => result.current.retry());
    await act(async () => vi.advanceTimersByTime(32));
    expect(result.current.failed).toBe(false);
    unmount();
    expect(r.waits[1]!.signal.aborted).toBe(true);
  });
  it("cancels an outdated initial target but does not cover the world again after reveal", async () => {
    vi.useFakeTimers();
    const r = renderer();
    const { result, rerender } = renderHook(
      ({ target }) => useWorldStartup(r.port, { kind: "ready" }, false, target),
      { initialProps: { target: "remembered" } },
    );
    await act(async () => vi.advanceTimersByTime(32));
    rerender({ target: "live" });
    await act(async () => vi.advanceTimersByTime(32));
    expect(r.waits[0]!.signal.aborted).toBe(true);
    await act(async () => r.waits[0]!.resolve());
    expect(result.current.ready).toBe(false);
    await act(async () => r.waits[1]!.resolve());
    expect(result.current.ready).toBe(true);
    rerender({ target: "later movement" });
    expect(result.current.ready).toBe(true);
    expect(r.whenSceneReady).toHaveBeenCalledTimes(2);
  });
});
