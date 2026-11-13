// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MapCamera,
  MapCameraChange,
  MapRenderer,
} from "@nilx-one/map-contract";

import type { BlockWeight } from "./block-weight";
import {
  BLOCK_EXIT_MS,
  BlockWeightProvider,
  WeightedBlock,
  useCameraWeight,
} from "./weighted-block";

afterEach(() => {
  vi.useRealTimers();
});

function weightSpy() {
  const stop = vi.fn<() => void>();
  return {
    register: vi.fn<BlockWeight["register"]>(() => stop),
    push: vi.fn<BlockWeight["push"]>(),
  };
}

describe("WeightedBlock", () => {
  it("joins the surface's clock with its mass while it is on the page", () => {
    const weight = weightSpy();
    const { unmount } = render(
      <BlockWeightProvider weight={weight}>
        <WeightedBlock className="card" mass={1.4}>
          Avaia
        </WeightedBlock>
      </BlockWeightProvider>,
    );

    const block = screen.getByText("Avaia");
    expect(block).toHaveClass("weighted-block", "card");
    expect(weight.register).toHaveBeenCalledWith(block, 1.4);
    unmount();
    expect(weight.register.mock.results[0]?.value).toHaveBeenCalledOnce();
  });

  it("is a plain block without a surface clock", () => {
    render(<WeightedBlock>Bond</WeightedBlock>);

    expect(screen.getByText("Bond")).toHaveAttribute(
      "data-presence",
      "present",
    );
  });

  it("leaves with an animation, hidden and inert, before it is gone", () => {
    vi.useFakeTimers();
    const { rerender } = render(<WeightedBlock show>Header</WeightedBlock>);

    rerender(<WeightedBlock show={false}>Header</WeightedBlock>);
    const leaving = screen.getByText("Header");
    expect(leaving).toHaveAttribute("data-presence", "exiting");
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving).toHaveAttribute("inert");

    act(() => {
      vi.advanceTimersByTime(BLOCK_EXIT_MS);
    });
    expect(screen.queryByText("Header")).toBeNull();
  });

  it("comes back at once if asked to stay while leaving", () => {
    vi.useFakeTimers();
    const { rerender } = render(<WeightedBlock show>Header</WeightedBlock>);

    rerender(<WeightedBlock show={false}>Header</WeightedBlock>);
    rerender(<WeightedBlock show>Header</WeightedBlock>);
    act(() => {
      vi.advanceTimersByTime(BLOCK_EXIT_MS);
    });

    expect(screen.getByText("Header")).toHaveAttribute(
      "data-presence",
      "present",
    );
  });
});

describe("useCameraWeight", () => {
  it("reads the camera every frame of a move and pushes the blocks", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      frames.push(callback),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    let current: MapCamera = {
      center: [30.5, 50.45],
      zoom: 15,
      bearing: 0,
      pitch: 0,
    };
    let listener: ((change: MapCameraChange) => void) | undefined;
    const renderer: Pick<MapRenderer, "getCamera" | "subscribeCamera"> = {
      getCamera: () => current,
      subscribeCamera: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
    };
    const weight = weightSpy();
    function Probe() {
      useCameraWeight(renderer, weight);
      return null;
    }
    const { unmount } = render(<Probe />);

    act(() => {
      listener?.({ camera: current, gesture: true, phase: "start" });
    });
    current = { ...current, center: [30.501, 50.45] };
    frames.shift()?.(16);
    current = { ...current, center: [30.502, 50.45] };
    frames.shift()?.(32);

    expect(weight.push).toHaveBeenCalledTimes(2);
    expect(weight.push.mock.calls[0]?.[0].x).toBeLessThan(0);

    act(() => {
      listener?.({ camera: current, gesture: true, phase: "end" });
    });
    while (frames.length > 0) frames.shift()?.(48);
    expect(weight.push).toHaveBeenCalledTimes(2);

    unmount();
    expect(listener).toBeUndefined();
  });
});
