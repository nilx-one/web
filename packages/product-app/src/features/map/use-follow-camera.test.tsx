// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapCameraChange,
  MapRenderer,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CAMERA_MODES,
  FOLLOW_HOLD_MS,
  FOLLOW_PITCH,
  cameraModesFor,
  ISOMETRIC_BEARING,
  ISOMETRIC_ENTRY_MAX_ZOOM,
  ISOMETRIC_PITCH,
  isometricCamera,
  FOLLOW_MIN_ZOOM,
  followCamera,
  GLANCE_PITCH,
  glanceCamera,
  smoothFollowCamera,
  type FollowFocus,
  type FollowBody,
} from "./follow-camera";
import { FOCUS_CHECK_MS, useFollowCamera } from "./use-follow-camera";

const HOME = { longitude: 24.03, latitude: 49.84, bearingDeg: 0 };
const AHEAD = { longitude: 24.0301, latitude: 49.8401, bearingDeg: 90 };
const FAR = { longitude: 24.05, latitude: 49.86 };

function fakeRenderer() {
  let camera: MapCamera = followCamera(
    {
      center: [HOME.longitude, HOME.latitude],
      zoom: 18.5,
      bearing: 30,
      pitch: 48,
    },
    HOME,
  );
  const listeners = new Set<(change: MapCameraChange) => void>();
  const renderer = {
    getCamera: () => camera,
    setCamera: vi.fn((next: MapCamera) => {
      camera = next;
    }),
    setZoomPivot: vi.fn(),
    subscribeCamera: (listener: (change: MapCameraChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    renderer: renderer as unknown as MapRenderer & typeof renderer,
    /** A person's gesture, from its first frame to where it settles. */
    gesture(next: Partial<MapCamera>, touch = false) {
      const from = touch ? { touch } : {};
      for (const listener of listeners) {
        listener({ camera, gesture: true, phase: "start", ...from });
      }
      camera = { ...camera, ...next };
      for (const listener of listeners) {
        listener({ camera, gesture: true, phase: "end", ...from });
      }
    },
    /** Two fingers zooming the camera by `levels`. */
    pinch(levels: number) {
      this.gesture({ zoom: camera.zoom + levels }, true);
    },
    /** A gesture that has started and not settled yet. */
    begin() {
      for (const listener of listeners) {
        listener({ camera, gesture: true, phase: "start" });
      }
    },
    settle() {
      for (const listener of listeners) {
        listener({ camera, gesture: false, phase: "end" });
      }
    },
  };
}

function follow(
  fake: ReturnType<typeof fakeRenderer>,
  body: () => FollowBody | undefined = () => HOME,
  enabled = true,
) {
  return renderHook(
    ({ on }) =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: on,
        body,
        dimension: "volumetric",
        reducedMotion: () => false,
      }),
    { initialProps: { on: enabled } },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useFollowCamera", () => {
  it("accepts an available initial Isometric mode, but not a disabled one", () => {
    const fake = fakeRenderer();
    const { result, unmount } = renderHook(() =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: true,
        body: () => HOME,
        dimension: "volumetric",
        reducedMotion: () => false,
        initialMode: "isometric",
      }),
    );
    expect(result.current.follow).toBe("isometric");
    unmount();

    const xping = fakeRenderer();
    const limited = renderHook(() =>
      useFollowCamera({
        renderer: xping.renderer,
        enabled: true,
        body: () => HOME,
        dimension: "volumetric",
        reducedMotion: () => false,
        modes: cameraModesFor("xping"),
        initialMode: "isometric",
      }),
    );
    expect(limited.result.current.follow).toBe("locked");
    limited.unmount();
  });

  it("cycles three Follow distances and retains each through walking", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);
    for (const zoom of [21.5, 21, 20.5, 21.5]) {
      act(() => result.current.selectFollow());
      expect(fake.renderer.getCamera()).toMatchObject({
        zoom,
        pitch: FOLLOW_PITCH,
        bearing: HOME.bearingDeg,
      });
      fake.settle();
      result.current.track(AHEAD);
      // The camera comes round behind the turned body over a few frames.
      act(() => vi.advanceTimersByTime(3_000));
      expect(fake.renderer.getCamera()).toMatchObject({
        zoom,
        bearing: AHEAD.bearingDeg,
      });
    }
  });

  it("comes round when the body turns instead of snapping behind it", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFollow());
    fake.settle();
    // Acquired facing north; then the walk turns a corner, east.
    result.current.track(HOME);
    result.current.track(AHEAD);
    act(() => vi.advanceTimersByTime(100));
    const turning = fake.renderer.getCamera().bearing;
    expect(turning).toBeGreaterThan(0);
    expect(turning).toBeLessThan(AHEAD.bearingDeg);
    // The body stays framed while the world turns.
    expect(fake.renderer.getCamera()).toEqual(
      smoothFollowCamera(
        { ...fake.renderer.getCamera(), bearing: turning },
        AHEAD,
        0,
      ),
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(fake.renderer.getCamera().bearing).toBe(AHEAD.bearingDeg);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Free steps out three times then back three times around the current driver", () => {
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = follow(fake, () => body);
    for (const zoom of [17.5, 16.5, 15.5, 16.5, 17.5, 18.5, 17.5]) {
      body = { ...body, longitude: body.longitude + 0.001 };
      act(() => result.current.selectFree());
      expect(result.current.follow).toBe("free");
      expect(fake.renderer.getCamera()).toMatchObject({
        zoom,
        center: [body.longitude, body.latitude],
      });
      fake.renderer.setCamera.mockClear();
      result.current.track(AHEAD);
      expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    }
  });

  it("advances rapid button presses while the renderer is still between distances", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    // An eased renderer reports its intermediate camera, not the last target.
    fake.renderer.setCamera.mockImplementation(() => undefined);
    act(() => {
      result.current.selectFollow();
      result.current.selectFollow();
      result.current.selectFollow();
    });
    expect(
      fake.renderer.setCamera.mock.calls.map(([camera]) => camera.zoom),
    ).toEqual([21.5, 21, 20.5]);
    fake.renderer.setCamera.mockClear();
    // Free anchors on the last Follow target (20.5), not the stale 18.5.
    act(() => {
      for (let i = 0; i < 6; i++) result.current.selectFree();
    });
    expect(
      fake.renderer.setCamera.mock.calls.map(([camera]) => camera.zoom),
    ).toEqual([19.5, 18.5, 17.5, 18.5, 19.5, 20.5]);
  });

  it("restarts the Free cycle after exploration and enters Follow at the close preset", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFree());
    act(() =>
      fake.gesture({ zoom: 16, center: [FAR.longitude, FAR.latitude] }),
    );
    act(() => result.current.selectFree());
    expect(fake.renderer.getCamera()).toMatchObject({
      zoom: 15,
      center: [HOME.longitude, HOME.latitude],
    });
    act(() => result.current.selectFollow());
    expect(fake.renderer.getCamera().zoom).toBe(21.5);
    act(() => result.current.selectFree());
    expect(fake.renderer.getCamera().zoom).toBe(20.5);
  });

  it("does not consume distance steps without a body or while a scene owns the camera", () => {
    const fake = fakeRenderer();
    const body = { current: undefined as FollowBody | undefined };
    const { result, rerender } = follow(fake, () => body.current);
    act(() => {
      result.current.selectFollow();
      result.current.selectFree();
    });
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    body.current = HOME;
    rerender({ on: false });
    act(() => {
      result.current.selectFollow();
      result.current.selectFree();
    });
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    rerender({ on: true });
    act(() => result.current.selectFollow());
    expect(fake.renderer.getCamera().zoom).toBe(21.5);
  });

  it("keeps manual Follow zoom in either direction down to the normal floor", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFollow());
    fake.settle();
    act(() => fake.gesture({ zoom: 20 }));
    result.current.track(AHEAD);
    expect(fake.renderer.getCamera()).toMatchObject({
      zoom: 20,
      bearing: AHEAD.bearingDeg,
    });
    act(() => fake.gesture({ zoom: 23 }));
    expect(fake.renderer.getCamera().zoom).toBe(23);
    act(() => fake.gesture({ zoom: 17 }));
    expect(fake.renderer.getCamera().zoom).toBe(FOLLOW_MIN_ZOOM);
  });

  it("uses the normal Follow floor for Space and tracking after a preset", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFollow());
    fake.settle();
    act(() => result.current.selectFree());
    fake.settle();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    });
    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.getCamera().zoom).toBe(20.5);
    fake.settle();
    result.current.track(AHEAD);
    expect(fake.renderer.getCamera().zoom).toBe(20.5);
  });

  it("starts a new Free cycle at the actual zoom after another move settles", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFollow());
    fake.settle();
    fake.renderer.setCamera({ ...fake.renderer.getCamera(), zoom: 16 });
    fake.settle();
    act(() => result.current.selectFree());
    expect(fake.renderer.getCamera().zoom).toBe(15);
  });

  it("keeps the new zoom target when starting an ease settles the previous move", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    // MapLibre stops the previous ease synchronously inside the new easeTo.
    // The renderer still reports the previous camera in that moveend event.
    fake.renderer.setCamera.mockImplementation(() => fake.settle());
    act(() => {
      result.current.selectFollow();
      result.current.selectFollow();
      result.current.selectFree();
    });
    expect(
      fake.renderer.setCamera.mock.calls.map(([camera]) => camera.zoom),
    ).toEqual([21.5, 21, 20]);
  });

  it("uses immediate distance changes with reduced motion and preserves flat mode", () => {
    const fake = fakeRenderer();
    const { result } = renderHook(() =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: true,
        body: () => HOME,
        dimension: "flat",
        reducedMotion: () => true,
      }),
    );
    act(() => result.current.selectFollow());
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 21.5, pitch: 0 }),
      { motion: "immediate" },
    );
    act(() => result.current.selectFree());
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 20.5, pitch: 0 }),
      { motion: "immediate" },
    );
  });

  it("lets a person zoom out after choosing a Follow distance", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.selectFollow());
    fake.settle();
    act(() => fake.gesture({ zoom: 20 }));
    expect(fake.renderer.getCamera().zoom).toBe(20);
    result.current.track(AHEAD);
    expect(fake.renderer.getCamera().zoom).toBe(20);
    act(() => result.current.center());
    expect(fake.renderer.getCamera().zoom).toBe(20);
    // The manual zoom replaced the preset, so the next press enters close.
    act(() => result.current.selectFollow());
    expect(fake.renderer.getCamera().zoom).toBe(21.5);
  });

  it("enters Follow at the close preset after a press without a body", () => {
    const fake = fakeRenderer();
    const body = { current: HOME as FollowBody | undefined };
    const { result } = follow(fake, () => body.current);
    act(() => {
      result.current.selectFollow();
      result.current.selectFollow();
    });
    expect(fake.renderer.getCamera().zoom).toBe(21);
    act(() => result.current.release());
    body.current = undefined;
    act(() => result.current.selectFollow());
    body.current = HOME;
    act(() => result.current.selectFollow());
    expect(fake.renderer.getCamera().zoom).toBe(21.5);
  });

  it("restarts the Free cycle when a scene hands the camera back", () => {
    const fake = fakeRenderer();
    const { result, rerender } = follow(fake);
    act(() => result.current.selectFree());
    expect(fake.renderer.getCamera().zoom).toBe(17.5);
    rerender({ on: false });
    fake.renderer.setCamera({ ...fake.renderer.getCamera(), zoom: 14 });
    rerender({ on: true });
    act(() => result.current.selectFree());
    expect(fake.renderer.getCamera().zoom).toBe(13);
  });

  it("keeps a walking body in the middle of the world", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    result.current.track(AHEAD);

    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      {
        center: followCamera(fake.renderer.getCamera(), AHEAD).center,
        zoom: FOLLOW_MIN_ZOOM,
        bearing: 90,
        pitch: FOLLOW_PITCH,
      },
      { yieldToGesture: true },
    );
  });

  it("closes in on the body while locked and on the pointer once free", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("center");

    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));
    expect(result.current.follow).toBe("locked");
    fake.renderer.setCamera.mockClear();

    act(() => result.current.release());
    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("pointer");
  });

  it("brings a Follow camera dragged off the body straight back to it", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));

    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        center: followCamera(fake.renderer.getCamera(), HOME).center,
      }),
      { motion: "eased" },
    );
  });

  it("leaves Follow for Free when two fingers pinch out", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => fake.pinch(-1));

    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("pointer");
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });

  it("keeps Free detached when two fingers pinch in", () => {
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = follow(fake, () => body);
    act(() => result.current.release());
    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }, true));
    body = AHEAD;
    fake.renderer.setCamera.mockClear();

    act(() => fake.pinch(1));

    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("pointer");
  });

  it("keeps the mode for a small pinch, a pinch the same way, or a wheel", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => fake.pinch(-0.2));
    expect(result.current.follow).toBe("locked");
    act(() => fake.pinch(1));
    expect(result.current.follow).toBe("locked");
    act(() => fake.gesture({ zoom: 15 }));
    expect(result.current.follow).toBe("locked");

    act(() => result.current.release());
    act(() => fake.pinch(-1));
    expect(result.current.follow).toBe("free");
    act(() => fake.gesture({ zoom: 19 }));
    expect(result.current.follow).toBe("free");
  });

  it("does not change the mode by pinching while a scene has the camera", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake, () => HOME, false);

    act(() => fake.pinch(-1));

    expect(result.current.follow).toBe("locked");
  });

  it("returns behind a stationary head after orbit and tilt", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => fake.gesture({ bearing: 200, pitch: 0, zoom: 22 }));
    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bearing: HOME.bearingDeg,
        pitch: FOLLOW_PITCH,
        zoom: 22,
      }),
      { motion: "eased" },
    );
  });

  it("tracks a turn in place and does not write again once settled", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    const turned = { ...HOME, bearingDeg: 270 };
    result.current.track(turned);
    expect(fake.renderer.getCamera().bearing).toBe(270);
    result.current.track(turned);
    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
  });

  it("does not fight a gesture, then resumes when moveend lacks originalEvent", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    fake.begin();
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();

    // Some MapLibre moveend events omit originalEvent although the earlier
    // movestart was user-owned. Gesture ownership must still be released.
    fake.settle();
    fake.renderer.setCamera.mockClear();
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
  });

  it("lets Free pan independently without pulling back to the moving body", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => result.current.release());
    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));

    result.current.track(AHEAD);
    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });

  it("brings the camera back onto the body on Space, and toggles on Y", () => {
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = follow(fake, () => body);
    act(() => result.current.release());
    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));
    body = AHEAD;

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
        }),
      );
    });

    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        center: followCamera(fake.renderer.getCamera(), AHEAD).center,
      }),
      { motion: "eased" },
    );

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }),
      );
    });
    expect(result.current.follow).toBe("free");
  });

  it("holds focus and handovers without silently leaving the selected Free mode", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.release());
    act(() => result.current.holdFocus());

    expect(result.current.follow).toBe("free");
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });

  it("lets the application's own move finish before following again", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.holdFocus());
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();

    fake.settle();
    fake.renderer.setCamera.mockClear();
    result.current.track(AHEAD);
    act(() => vi.advanceTimersByTime(16));
    expect(fake.renderer.setCamera).toHaveBeenCalled();
  });

  it("frames a stationary body when an opening flight settles", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake, () => AHEAD);
    act(() => result.current.hold(FOLLOW_HOLD_MS));
    fake.settle();
    expect(fake.renderer.getCamera()).toEqual(
      followCamera(fake.renderer.getCamera(), AHEAD),
    );
  });

  it("does not sample the moving body recursively on tracking moveend", () => {
    const fake = fakeRenderer();
    const body = vi.fn(() => AHEAD);
    const { result } = follow(fake, body);
    const setCamera = fake.renderer.setCamera.getMockImplementation()!;
    fake.renderer.setCamera.mockImplementation((next) => {
      setCamera(next);
      fake.settle();
    });
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
    expect(body).not.toHaveBeenCalled();
  });

  it("follows again once the hold has run out", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.holdFocus());
    vi.advanceTimersByTime(FOLLOW_HOLD_MS + 1);
    result.current.track(AHEAD);

    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
  });

  it("stands down while a scene has the camera", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake, () => HOME, false);

    result.current.track(AHEAD);
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: " ",
          code: "Space",
          bubbles: true,
        }),
      );
    });

    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("pointer");
  });

  it("releases the camera when the application takes it off the body", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.release());
    result.current.track(AHEAD);

    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });
});

function isometricFollow(
  fake: ReturnType<typeof fakeRenderer>,
  body: () => FollowBody | undefined = () => HOME,
) {
  const hook = follow(fake, body);
  act(() => hook.result.current.selectIsometric());
  fake.settle();
  fake.renderer.setCamera.mockClear();
  return hook;
}

describe("isometric tracking", () => {
  it("uses the pending Follow target but caps a close-up on Isometric entry", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    fake.renderer.setCamera.mockImplementation(() => undefined);
    act(() => result.current.selectFollow());
    act(() => result.current.selectIsometric());
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zoom: ISOMETRIC_ENTRY_MAX_ZOOM,
        bearing: ISOMETRIC_BEARING,
        pitch: ISOMETRIC_PITCH,
      }),
      { motion: "eased" },
    );
  });

  it("Y exits Isometric to Free, but only the button can restore Isometric", () => {
    const fake = fakeRenderer();
    const { result } = isometricFollow(fake);
    const key = (code: string) =>
      act(() =>
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { code, bubbles: true }),
        ),
      );
    key("KeyY");
    expect(result.current.follow).toBe("free");
    key("KeyY");
    expect(result.current.follow).toBe("locked");
    act(() => result.current.selectIsometric());
    expect(result.current.follow).toBe("isometric");
    key("Space");
    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.getCamera()).toMatchObject({
      bearing: HOME.bearingDeg,
      pitch: FOLLOW_PITCH,
    });
  });

  it("glides after acquisition and finishes catching up when the body stops", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = isometricFollow(fake, () => body);
    result.current.track(body);
    const before = fake.renderer.getCamera();
    body = { ...HOME, longitude: HOME.longitude + 0.00001 };
    result.current.track(body);
    act(() => vi.advanceTimersByTime(32));
    const mid = fake.renderer.getCamera();
    const target = isometricCamera(mid, body);
    expect(mid.center[0]).toBeGreaterThan(before.center[0]);
    expect(mid.center[0]).toBeLessThan(target.center[0]);
    // No more track calls: the camera owns the small tail after the last step.
    act(() => vi.advanceTimersByTime(2_000));
    expect(fake.renderer.getCamera()).toEqual(target);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts a new glide from rest instead of jumping over the time at rest", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = isometricFollow(fake, () => body);
    result.current.track(body);
    const rest = fake.renderer.getCamera();
    act(() => vi.advanceTimersByTime(600));
    body = { ...HOME, longitude: HOME.longitude + 0.00001 };
    result.current.track(body);
    expect(fake.renderer.getCamera()).toEqual(rest);
    act(() => vi.advanceTimersByTime(16));
    const first = fake.renderer.getCamera();
    const target = isometricCamera(first, body);
    const progress =
      (first.center[0] - rest.center[0]) / (target.center[0] - rest.center[0]);
    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(0.3);
  });

  it.each(["free", "follow", "gesture", "scene", "unmount"] as const)(
    "cancels pending follow frames on %s",
    (interruption) => {
      vi.useFakeTimers();
      const fake = fakeRenderer();
      const { result, rerender, unmount } = isometricFollow(fake);
      result.current.track(HOME);
      result.current.track({ ...HOME, longitude: HOME.longitude + 0.00001 });
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      act(() => {
        if (interruption === "free") result.current.release();
        if (interruption === "follow") result.current.selectFollow();
        if (interruption === "gesture") fake.begin();
        if (interruption === "scene") rerender({ on: false });
        if (interruption === "unmount") unmount();
      });
      fake.renderer.setCamera.mockClear();
      act(() => vi.advanceTimersByTime(2_000));
      expect(fake.renderer.setCamera).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not add a tracking tail for reduced motion", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = renderHook(() =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: true,
        body: () => HOME,
        dimension: "volumetric",
        reducedMotion: () => true,
      }),
    );
    act(() => result.current.selectIsometric());
    fake.settle();
    result.current.track(HOME);
    result.current.track(AHEAD);
    expect(fake.renderer.getCamera()).toEqual(
      isometricCamera(fake.renderer.getCamera(), AHEAD),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps Follow, Isometric and Free independent until explicitly selected", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    expect(result.current.follow).toBe("locked");
    result.current.track({ ...HOME, bearingDeg: 270 });
    expect(fake.renderer.getCamera().bearing).toBe(270);
    act(() => result.current.selectIsometric());
    expect(result.current.follow).toBe("isometric");
    expect(fake.renderer.getCamera()).toMatchObject({
      bearing: ISOMETRIC_BEARING,
      pitch: ISOMETRIC_PITCH,
    });
    fake.settle();
    fake.renderer.setCamera.mockClear();
    result.current.track({ ...HOME, bearingDeg: 180 });
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    act(() => fake.pinch(-1));
    expect(result.current.follow).toBe("free");
    act(() => fake.pinch(1));
    expect(result.current.follow).toBe("free");
    act(() => result.current.selectIsometric());
    expect(result.current.follow).toBe("isometric");
    act(() => result.current.selectFollow());
    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.getCamera()).toMatchObject({
      bearing: HOME.bearingDeg,
      pitch: FOLLOW_PITCH,
      zoom: 21.5,
    });
  });
});

describe("identity camera modes", () => {
  function followOnly(fake: ReturnType<typeof fakeRenderer>) {
    return renderHook(
      ({ modes }) =>
        useFollowCamera({
          renderer: fake.renderer,
          enabled: true,
          body: () => HOME,
          dimension: "volumetric",
          reducedMotion: () => false,
          modes,
        }),
      { initialProps: { modes: cameraModesFor("xping") } },
    );
  }

  it("offers xPing Follow alone while Bond and Avaia keep every mode", () => {
    expect(cameraModesFor("xping")).toEqual(["locked"]);
    expect(cameraModesFor("bond")).toEqual(CAMERA_MODES);
    expect(cameraModesFor("avaia")).toEqual(CAMERA_MODES);
  });

  it("never leaves Follow through a button, pinch, Y or a release", () => {
    const fake = fakeRenderer();
    const { result } = followOnly(fake);
    act(() => result.current.selectIsometric());
    act(() => result.current.selectFree());
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
    act(() => fake.pinch(-1));
    expect(result.current.follow).toBe("locked");
    const y = new KeyboardEvent("keydown", {
      code: "KeyY",
      bubbles: true,
      cancelable: true,
    });
    act(() => document.body.dispatchEvent(y));
    expect(y.defaultPrevented).toBe(false);
    act(() => result.current.release());
    expect(result.current.follow).toBe("locked");
  });

  it("returns to Follow when the new identity does not offer the mode in use", () => {
    const fake = fakeRenderer();
    const { result, rerender } = followOnly(fake);
    rerender({ modes: CAMERA_MODES });
    act(() => result.current.selectIsometric());
    expect(result.current.follow).toBe("isometric");
    rerender({ modes: cameraModesFor("xping") });
    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.getCamera()).toMatchObject({
      bearing: HOME.bearingDeg,
      pitch: FOLLOW_PITCH,
    });
  });
});

describe("a glance at what passes close", () => {
  // A drone about 80 m north-east of the body.
  const DRONE = { key: "drone:a", longitude: 24.0307, latitude: 49.8405 };

  function glancing(
    fake: ReturnType<typeof fakeRenderer>,
    focus: () => FollowFocus | undefined,
  ) {
    return renderHook(() =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: true,
        body: () => HOME,
        dimension: "volumetric",
        reducedMotion: () => false,
        focus,
      }),
    );
  }

  it("looks at it over the body's shoulder while it lasts, then comes back", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    let subject: FollowFocus | undefined;
    const { result } = glancing(fake, () => subject);
    result.current.track(HOME);
    const usual = fake.renderer.getCamera();

    subject = DRONE;
    act(() => vi.advanceTimersByTime(FOCUS_CHECK_MS + 3_000));
    const look = glanceCamera(usual, HOME, DRONE);
    const seen = fake.renderer.getCamera();
    expect(Math.abs(seen.bearing - look.bearing)).toBeLessThan(1.5);
    expect(seen.pitch).toBeCloseTo(GLANCE_PITCH, 0);
    expect(seen.bearing).toBeGreaterThan(20);
    expect(seen.bearing).toBeLessThan(70);

    // It flew on: the usual view comes back, at the distance it had.
    subject = undefined;
    act(() => vi.advanceTimersByTime(4_000));
    const back = fake.renderer.getCamera();
    expect(back.zoom).toBeCloseTo(usual.zoom, 2);
    expect(back.pitch).toBeCloseTo(usual.pitch, 1);
    expect(back.bearing).toBeCloseTo(usual.bearing, 0);
  });

  it("gives the usual view back the moment a person moves the camera", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const subject: FollowFocus = DRONE;
    const usual = fake.renderer.getCamera();
    const { result } = glancing(fake, () => subject);
    result.current.track(HOME);
    act(() => vi.advanceTimersByTime(FOCUS_CHECK_MS + 3_000));
    expect(fake.renderer.getCamera().pitch).toBeCloseTo(GLANCE_PITCH, 0);

    // A pan: the glance is dropped and the usual framing is aimed for.
    act(() =>
      fake.gesture({
        center: [HOME.longitude + 0.0002, HOME.latitude],
      }),
    );
    fake.settle();
    expect(fake.renderer.getCamera()).toMatchObject({
      zoom: usual.zoom,
      pitch: FOLLOW_PITCH,
    });
    // The same drone is not glanced at again.
    act(() => vi.advanceTimersByTime(FOCUS_CHECK_MS + 3_000));
    expect(fake.renderer.getCamera().pitch).toBe(FOLLOW_PITCH);
  });

  it("never takes a Free camera", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = glancing(fake, () => DRONE);
    act(() => result.current.release());
    fake.renderer.setCamera.mockClear();
    result.current.track(HOME);
    act(() => vi.advanceTimersByTime(FOCUS_CHECK_MS * 3));
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });
});
