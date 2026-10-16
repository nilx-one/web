// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMapRendererDouble } from "../../../../../tests/support/doubles";
import { chooseLocale } from "../../shell/localization";
import { CameraModeControl, CAMERA_MODE_IDLE_MS } from "./camera-mode-control";
import type { CameraFollow } from "./follow-camera";
import { useFollowCamera } from "./use-follow-camera";

beforeEach(() => {
  vi.useFakeTimers();
  chooseLocale("en");
});
afterEach(() => {
  vi.useRealTimers();
  chooseLocale("auto");
});

function setup(mode: CameraFollow = "locked") {
  const renderer = createMapRendererDouble();
  const props = {
    renderer,
    mode,
    onFollow: vi.fn(),
    onIsometric: vi.fn(),
    onFree: vi.fn(),
  };
  return { ...render(<CameraModeControl {...props} />), props, renderer };
}

describe("CameraModeControl", () => {
  it.each([
    ["locked", "Follow"],
    ["isometric", "Isometric"],
    ["free", "Free"],
  ] as const)(
    "collapses to %s on a map gesture, opens without selecting, then idles closed",
    (mode, label) => {
      const { renderer, props } = setup(mode);
      expect(screen.getAllByRole("button")).toHaveLength(3);
      act(() => renderer.moveCamera(renderer.getCamera(), true));
      expect(screen.getAllByRole("button")).toHaveLength(1);
      const chip = screen.getByRole("button", { name: label });
      expect(chip).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(chip);
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(props.onFollow).not.toHaveBeenCalled();
      expect(props.onFree).not.toHaveBeenCalled();
      expect(props.onIsometric).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(CAMERA_MODE_IDLE_MS));
      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(screen.getByRole("button", { name: label })).toBeVisible();
    },
  );

  it("retains mode selection and distance cycling while expanded", () => {
    const { props } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Follow" }));
    expect(props.onFollow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Free" }));
    expect(props.onFree).toHaveBeenCalledOnce();
  });

  it("also opens when the collapsed panel padding is pressed", () => {
    const { renderer } = setup();
    act(() => renderer.moveCamera(renderer.getCamera(), true));
    fireEvent.click(screen.getByRole("group"));
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("restarts inactivity on panel interaction but not automatic camera tracking", () => {
    const { renderer } = setup();
    act(() => vi.advanceTimersByTime(2_000));
    fireEvent.pointerDown(screen.getByRole("group"));
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getAllByRole("button")).toHaveLength(3);
    act(() => renderer.moveCamera(renderer.getCamera(), false));
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("collapses immediately when the person initiates a ground move", () => {
    const { renderer } = setup();
    act(() =>
      renderer.tapGround({ longitude: 24, latitude: 50, ground: "open" }),
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("reveals Free after the real pinch policy changes the mode", () => {
    const renderer = createMapRendererDouble();
    function Harness() {
      const camera = useFollowCamera({
        renderer,
        enabled: true,
        body: () => ({ longitude: 24, latitude: 50, bearingDeg: 0 }),
        dimension: "volumetric",
        reducedMotion: () => true,
      });
      return (
        <CameraModeControl
          renderer={renderer}
          mode={camera.follow}
          onFollow={camera.selectFollow}
          onIsometric={camera.selectIsometric}
          onFree={camera.selectFree}
        />
      );
    }
    render(<Harness />);
    const listeners = vi
      .mocked(renderer.subscribeCamera)
      .mock.calls.map(([listener]) => listener);
    act(() =>
      listeners.forEach((listener) =>
        listener({
          camera: { ...renderer.getCamera(), zoom: 20 },
          gesture: true,
          touch: true,
          phase: "start",
        }),
      ),
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    act(() =>
      listeners.forEach((listener) =>
        listener({
          camera: { ...renderer.getCamera(), zoom: 19 },
          gesture: true,
          touch: true,
          phase: "end",
        }),
      ),
    );
    expect(screen.getByRole("button", { name: "Free" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    act(() => vi.advanceTimersByTime(CAMERA_MODE_IDLE_MS));
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Free" })).toBeVisible();
  });

  it("keeps focus on the visible chip when hiding another focused button", () => {
    setup();
    act(() => screen.getByRole("button", { name: "Free" }).focus());
    act(() => vi.advanceTimersByTime(CAMERA_MODE_IDLE_MS));
    expect(screen.getByRole("button", { name: "Follow" })).toHaveFocus();
  });

  it("clears the idle timer on unmount", () => {
    const { unmount } = setup();
    const timers = vi.getTimerCount();
    expect(timers).toBeGreaterThanOrEqual(1);
    unmount();
    expect(vi.getTimerCount()).toBe(timers - 1);
  });
});
