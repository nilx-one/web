// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapDimension, MapRenderer } from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FOLLOW_HOLD_MS,
  INITIAL_CAMERA_FOLLOW,
  cameraKeyCommand,
  followAfterPinch,
  followCamera,
  zoomPivotFor,
  sameFollowCamera,
  type FollowBody,
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
  readonly body: () => FollowBody | undefined;
  readonly dimension: MapDimension;
  readonly reducedMotion: () => boolean;
}

export interface FollowCameraState {
  readonly follow: CameraFollow;
  /** Keeps the camera on a body that moved this frame, while locked. */
  track(point: FollowBody): void;
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
  dimension,
  reducedMotion,
}: FollowCameraInput): FollowCameraState {
  const [follow, setFollow] = useState<CameraFollow>(INITIAL_CAMERA_FOLLOW);
  const followRef = useRef(follow);
  const gesturing = useRef(false);
  /** The touch gesture under way, and the zoom it started from. */
  const touchStart = useRef<number | undefined>(undefined);
  const heldUntil = useRef(0);
  const input = useRef({ enabled, body, dimension, reducedMotion });
  useEffect(() => {
    input.current = { enabled, body, dimension, reducedMotion };
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
    renderer.setCamera(
      followCamera(renderer.getCamera(), point, input.current.dimension),
      {
        motion: input.current.reducedMotion() ? "immediate" : "eased",
      },
    );
  }, [choose, hold, renderer]);

  const track = useCallback(
    (point: FollowBody) => {
      if (
        !input.current.enabled ||
        followRef.current !== "locked" ||
        gesturing.current ||
        globalThis.performance.now() < heldUntil.current
      ) {
        return;
      }
      const current = renderer.getCamera();
      const target = followCamera(current, point, input.current.dimension);
      if (sameFollowCamera(current, target)) return;
      // Following is background motion: it never takes a gesture away.
      renderer.setCamera(target, {
        yieldToGesture: true,
      });
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
          touchStart.current =
            change.touch === true ? change.camera.zoom : undefined;
          return;
        }
        // MapLibre may omit originalEvent on moveend even when a user's
        // gesture started the move. Its start is authoritative until the
        // matching end; otherwise the follow would remain paused forever.
        if (gesturing.current || change.gesture) {
          gesturing.current = false;
          const startZoom = touchStart.current;
          touchStart.current = undefined;
          if (!input.current.enabled) return;
          // Two fingers on a phone choose the mode: out to Free, in to Follow.
          if (startZoom !== undefined) {
            const next = followAfterPinch(
              followRef.current,
              startZoom,
              change.camera.zoom,
            );
            if (next === "locked" && followRef.current === "free") {
              center();
              return;
            }
            if (next !== followRef.current) {
              choose(next);
              return;
            }
          }
          // Return behind the head after orbit/tilt/pan, even when stationary.
          // Free is the mode for keeping an independent viewing angle.
          const point = input.current.body();
          if (
            followRef.current === "locked" &&
            point !== undefined &&
            !sameFollowCamera(
              change.camera,
              followCamera(change.camera, point, input.current.dimension),
            )
          ) {
            hold(FOLLOW_HOLD_MS);
            renderer.setCamera(
              followCamera(change.camera, point, input.current.dimension),
              {
                motion: input.current.reducedMotion() ? "immediate" : "eased",
              },
            );
          }
          return;
        }
        // Only a purely programmatic settle releases an application hold.
        const wasHeld = heldUntil.current > 0;
        heldUntil.current = 0;
        // A tracking jump also emits moveend. Do not sample the moving body
        // recursively from that notification; its animation frame owns it.
        if (wasHeld) {
          const point = input.current.body();
          if (point !== undefined) track(point);
        }
      }),
    [center, choose, hold, renderer, track],
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
