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
  FOLLOW_HOLD_MS,
  FOLLOW_PITCH,
  FOLLOW_MIN_ZOOM,
  followCamera,
  type FollowBody,
} from "./follow-camera";
import { useFollowCamera } from "./use-follow-camera";

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
  it("cycles three Follow distances and retains each through walking", () => {
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
      expect(fake.renderer.getCamera()).toMatchObject({
        zoom,
        bearing: AHEAD.bearingDeg,
      });
    }
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
    act(() => {
      for (let i = 0; i < 6; i++) result.current.selectFree();
    });
    expect(
      fake.renderer.setCamera.mock.calls.map(([camera]) => camera.zoom),
    ).toEqual([17.5, 16.5, 15.5, 16.5, 17.5, 18.5]);
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

  it("returns to Follow on the body when two fingers pinch in", () => {
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = follow(fake, () => body);
    act(() => result.current.release());
    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }, true));
    body = AHEAD;

    act(() => fake.pinch(1));

    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith(
      expect.objectContaining({
        center: followCamera(fake.renderer.getCamera(), AHEAD).center,
      }),
      { motion: "eased" },
    );
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
    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
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
