// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapPointSelection, MapRenderer } from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FOLLOW_HOLD_MS,
  INITIAL_CAMERA_FOLLOW,
  cameraKeyCommand,
  followCamera,
  zoomPivotFor,
  type CameraFollow,
} from "./follow-camera";

export interface FollowCameraInput {
  readonly renderer: MapRenderer;
  /**
   * The world is at rest and the camera may follow: the map is ready and no
   * scene or informer is staging shots of its own.
   */
  readonly enabled: boolean;
  /** Where the body at the wheel stands this instant. */
  readonly body: () => MapPointSelection | undefined;
  readonly reducedMotion: () => boolean;
}

export interface FollowCameraState {
  readonly follow: CameraFollow;
  /** Keeps the camera on a body that moved this frame, while locked. */
  track(point: MapPointSelection): void;
  /** Hold a focus or handover without switching the selected camera mode. */
  holdFocus(): void;
  /** The application took the camera somewhere else than the body. */
  release(): void;
  /** Leave a camera move the application just started to finish. */
  hold(durationMs: number): void;
  /** Bring the camera back onto the body and lock it there. */
  center(): void;
}

export function useFollowCamera({
  renderer,
  enabled,
  body,
  reducedMotion,
}: FollowCameraInput): FollowCameraState {
  const [follow, setFollow] = useState<CameraFollow>(INITIAL_CAMERA_FOLLOW);
  const followRef = useRef(follow);
  const gesturing = useRef(false);
  const heldUntil = useRef(0);
  const input = useRef({ enabled, body, reducedMotion });
  useEffect(() => {
    input.current = { enabled, body, reducedMotion };
  });

  const choose = useCallback((next: CameraFollow) => {
    followRef.current = next;
    setFollow(next);
  }, []);

  const hold = useCallback((durationMs: number) => {
    heldUntil.current = Math.max(
      heldUntil.current,
      globalThis.performance.now() + durationMs,
    );
  }, []);

  const holdFocus = useCallback(() => hold(FOLLOW_HOLD_MS), [hold]);

  const release = useCallback(() => choose("free"), [choose]);

  const center = useCallback(() => {
    if (!input.current.enabled) return;
    choose("locked");
    const point = input.current.body();
    if (point === undefined) return;
    hold(FOLLOW_HOLD_MS);
    renderer.setCamera(followCamera(renderer.getCamera(), point), {
      motion: input.current.reducedMotion() ? "immediate" : "eased",
    });
  }, [choose, hold, renderer]);

  const track = useCallback(
    (point: MapPointSelection) => {
      if (
        !input.current.enabled ||
        followRef.current !== "locked" ||
        gesturing.current ||
        globalThis.performance.now() < heldUntil.current
      ) {
        return;
      }
      const current = renderer.getCamera();
      if (
        current.center[0] === point.longitude &&
        current.center[1] === point.latitude
      ) {
        return;
      }
      renderer.setCamera(followCamera(current, point));
    },
    [renderer],
  );

  // A locked camera closes in on the body; a free one zooms where the
  // person points, the way the map always has.
  useEffect(() => {
    renderer.setZoomPivot?.(enabled ? zoomPivotFor(follow) : "pointer");
  }, [enabled, follow, renderer]);
  useEffect(() => () => renderer.setZoomPivot?.("pointer"), [renderer]);

  useEffect(
    () =>
      renderer.subscribeCamera((change) => {
        if (change.phase === "start" && change.gesture) {
          gesturing.current = true;
          heldUntil.current = 0;
          return;
        }
        // MapLibre may omit originalEvent on moveend even when a user's
        // gesture started the move. Its start is authoritative until the
        // matching end; otherwise the follow would remain paused forever.
        if (gesturing.current || change.gesture) {
          gesturing.current = false;
          // A gesture never changes the explicit Follow/Free selection.
          return;
        }
        // Only a purely programmatic settle releases an application hold.
        heldUntil.current = 0;
      }),
    [renderer],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = cameraKeyCommand(event);
      if (command === undefined) return;
      event.preventDefault();
      if (command === "toggle" && followRef.current === "locked") {
        choose("free");
        return;
      }
      center();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [center, choose, enabled]);

  return useMemo(
    () => ({ follow, track, holdFocus, release, hold, center }),
    [center, follow, hold, holdFocus, release, track],
  );
}
