// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapCameraChange,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FOLLOW_HOLD_MS } from "./follow-camera";
import { useFollowCamera } from "./use-follow-camera";

const HOME = { longitude: 24.03, latitude: 49.84 };
const AHEAD = { longitude: 24.0301, latitude: 49.8401 };
const FAR = { longitude: 24.05, latitude: 49.86 };

function fakeRenderer() {
  let camera: MapCamera = {
    center: [HOME.longitude, HOME.latitude],
    zoom: 18.5,
    bearing: 30,
    pitch: 48,
  };
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
    gesture(next: Partial<MapCamera>) {
      for (const listener of listeners) {
        listener({ camera, gesture: true, phase: "start" });
      }
      camera = { ...camera, ...next };
      for (const listener of listeners) {
        listener({ camera, gesture: true, phase: "end" });
      }
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
  body: () => MapPointSelection | undefined = () => HOME,
  enabled = true,
) {
  return renderHook(
    ({ on }) =>
      useFollowCamera({
        renderer: fake.renderer,
        enabled: on,
        body,
        reducedMotion: () => false,
      }),
    { initialProps: { on: enabled } },
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useFollowCamera", () => {
  it("keeps a walking body in the middle of the world", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    result.current.track(AHEAD);

    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith({
      center: [AHEAD.longitude, AHEAD.latitude],
      zoom: 18.5,
      bearing: 30,
      pitch: 48,
    });
  });

  it("closes in on the body while locked and on the pointer once free", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("center");

    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));

    expect(result.current.follow).toBe("free");
    expect(fake.renderer.setZoomPivot).toHaveBeenLastCalledWith("pointer");
  });

  it("orbits around the body without letting go of it", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => fake.gesture({ bearing: 200, pitch: 60, zoom: 17.5 }));
    result.current.track(AHEAD);

    expect(result.current.follow).toBe("locked");
    expect(fake.renderer.setCamera).toHaveBeenLastCalledWith({
      center: [AHEAD.longitude, AHEAD.latitude],
      zoom: 17.5,
      bearing: 200,
      pitch: 60,
    });
  });

  it("does not fight a gesture that is still under way", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);

    fake.begin();
    result.current.track(AHEAD);

    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });

  it("leaves a camera the person sent elsewhere where it is", () => {
    const fake = fakeRenderer();
    const { result } = follow(fake);
    act(() => fake.gesture({ center: [FAR.longitude, FAR.latitude] }));

    result.current.track(AHEAD);

    expect(fake.renderer.setCamera).not.toHaveBeenCalled();
  });

  it("brings the camera back onto the body on Space, and toggles on Y", () => {
    const fake = fakeRenderer();
    let body = HOME;
    const { result } = follow(fake, () => body);
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
      expect.objectContaining({ center: [AHEAD.longitude, AHEAD.latitude] }),
      { motion: "eased" },
    );

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "y", code: "KeyY", bubbles: true }),
      );
    });
    expect(result.current.follow).toBe("free");
  });

  it("lets the application's own move finish before following again", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.lock());
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).not.toHaveBeenCalled();

    fake.settle();
    result.current.track(AHEAD);
    expect(fake.renderer.setCamera).toHaveBeenCalledOnce();
  });

  it("follows again once the hold has run out", () => {
    vi.useFakeTimers();
    const fake = fakeRenderer();
    const { result } = follow(fake);

    act(() => result.current.lock());
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
