// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapCamera,
  MapCameraOptions,
  MapDimension,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FOLLOW_HOLD_MS,
  FOLLOW_DISTANCE_ZOOMS,
  FREE_DISTANCE_STEPS,
  CAMERA_MODES,
  INITIAL_CAMERA_FOLLOW,
  cameraKeyCommand,
  followAfterPinch,
  followCamera,
  isometricCamera,
  isometricEntryCamera,
  zoomPivotFor,
  sameFollowCamera,
  closeToCamera,
  easeCamera,
  glanceCamera,
  smoothFollowCamera,
  smoothIsometricCamera,
  type FollowFocus,
  type FollowBody,
  type CameraFollow,
} from "./follow-camera";

/** How often a camera at rest looks for something worth a glance. */
export const FOCUS_CHECK_MS = 400;

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
  /**
   * The modes the identity at the wheel offers (`cameraModesFor`). Follow is
   * always available; nothing here switches into a mode outside this set.
   */
  readonly modes?: readonly CameraFollow[];
  /** First mode at mount; an unavailable mode falls back to Follow. */
  readonly initialMode?: CameraFollow;
  /**
   * Something worth a third-person look this instant, if anything: a drone
   * passing close, a monument the Avaia is telling about. While it lasts a
   * tracking camera looks at it over the body's shoulder; when it ends, or
   * the moment a person moves the camera, the usual view comes back.
   */
  readonly focus?: () => FollowFocus | undefined;
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
  /** Follow button: enter close, or cycle the three distances when selected. */
  selectFollow(): void;
  /** Free button: focus the driver and step out/out/out/in/in/in. */
  selectFree(): void;
  /** Select the independent smooth diagonal tracking mode. */
  selectIsometric(): void;
}

export function useFollowCamera({
  renderer,
  enabled,
  body,
  dimension,
  reducedMotion,
  modes = CAMERA_MODES,
  initialMode = INITIAL_CAMERA_FOLLOW,
  focus,
}: FollowCameraInput): FollowCameraState {
  const [follow, setFollow] = useState<CameraFollow>(() =>
    modes.includes(initialMode) ? initialMode : "locked",
  );
  const followRef = useRef(follow);
  // No explicit preset on entry: the next Follow press chooses the closest.
  const followDistance = useRef(-1);
  const freeCycle = useRef<{ zoom: number; step: number } | undefined>(
    undefined,
  );
  // The zoom of this hook's unfinished transition. A Free cycle anchors here
  // rather than on an intermediate eased frame, until the camera settles.
  const targetZoom = useRef<number | undefined>(undefined);
  const gesturing = useRef(false);
  /** The zoom the gesture under way started from. */
  const gestureStart = useRef<number | undefined>(undefined);
  /** The touch gesture under way, and the zoom it started from. */
  const touchStart = useRef<number | undefined>(undefined);
  const heldUntil = useRef(0);
  const trackedBody = useRef<FollowBody | undefined>(undefined);
  const trackingFrame = useRef<number | undefined>(undefined);
  const trackingTime = useRef<number | undefined>(undefined);
  const input = useRef({
    enabled,
    body,
    dimension,
    reducedMotion,
    modes,
    focus,
  });
  useEffect(() => {
    input.current = { enabled, body, dimension, reducedMotion, modes, focus };
  });
  /**
   * The glance under way, if any: what it looks at, and the zoom the usual
   * view had before it, which the camera goes back to when it ends.
   */
  const glance = useRef<
    | {
        readonly key: string;
        readonly zoom: number;
        readonly returning: boolean;
      }
    | undefined
  >(undefined);
  /** What a person looked away from: never glanced at again. */
  const dismissed = useRef(new Set<string>());
  const activeFocus = useCallback((): FollowFocus | undefined => {
    if (followRef.current === "free") return undefined;
    const subject = input.current.focus?.();
    if (subject === undefined || dismissed.current.has(subject.key)) {
      return undefined;
    }
    return subject;
  }, []);
  const available = useCallback(
    (mode: CameraFollow) =>
      mode === "locked" || input.current.modes.includes(mode),
    [],
  );

  const stopTracking = useCallback(() => {
    if (trackingFrame.current !== undefined) {
      globalThis.cancelAnimationFrame(trackingFrame.current);
    }
    trackingFrame.current = undefined;
    trackingTime.current = undefined;
    trackedBody.current = undefined;
  }, []);
  useEffect(() => () => stopTracking(), [stopTracking]);

  const choose = useCallback(
    (next: CameraFollow) => {
      if (next !== followRef.current) stopTracking();
      if (next !== followRef.current) freeCycle.current = undefined;
      followRef.current = next;
      setFollow(next);
    },
    [stopTracking],
  );

  const hold = useCallback(
    (durationMs: number) => {
      stopTracking();
      heldUntil.current = Math.max(
        heldUntil.current,
        globalThis.performance.now() + durationMs,
      );
    },
    [stopTracking],
  );

  const holdFocus = useCallback(() => hold(FOLLOW_HOLD_MS), [hold]);

  const aim = useCallback(
    (camera: MapCamera, options: MapCameraOptions) => {
      renderer.setCamera(camera, options);
      // Starting an ease may synchronously settle the previous move. Publish
      // the new target afterwards so that old moveend cannot erase it.
      targetZoom.current = camera.zoom;
    },
    [renderer],
  );

  // A scene or programmatic move while disabled invalidates both anchors.
  useEffect(() => {
    stopTracking();
    freeCycle.current = undefined;
    targetZoom.current = undefined;
  }, [enabled, dimension, stopTracking]);

  // An identity without Free keeps following: the application's own move is
  // given its time, then the camera returns to the body.
  const release = useCallback(() => {
    if (available("free")) choose("free");
    else holdFocus();
  }, [available, choose, holdFocus]);

  const frameBody = useCallback(
    (camera: MapCamera, point: FollowBody) =>
      followRef.current === "isometric"
        ? isometricCamera(camera, point, input.current.dimension)
        : followCamera(camera, point, input.current.dimension),
    [],
  );

  const selectIsometric = useCallback(() => {
    if (!input.current.enabled || !available("isometric")) return;
    choose("isometric");
    const point = input.current.body();
    if (point === undefined) return;
    const current = renderer.getCamera();
    hold(FOLLOW_HOLD_MS);
    aim(
      isometricEntryCamera(
        { ...current, zoom: targetZoom.current ?? current.zoom },
        point,
        input.current.dimension,
      ),
      {
        motion: input.current.reducedMotion() ? "immediate" : "eased",
      },
    );
  }, [aim, available, choose, hold, renderer]);

  const center = useCallback(() => {
    if (!input.current.enabled) return;
    choose("locked");
    const point = input.current.body();
    if (point === undefined) return;
    hold(FOLLOW_HOLD_MS);
    aim(followCamera(renderer.getCamera(), point, input.current.dimension), {
      motion: input.current.reducedMotion() ? "immediate" : "eased",
    });
  }, [aim, choose, hold, renderer]);

  const selectFollow = useCallback(() => {
    if (!input.current.enabled) return;
    const point = input.current.body();
    if (point === undefined) {
      // Without a body nothing is framed; the next press enters at close.
      followDistance.current = -1;
      choose("locked");
      return;
    }
    followDistance.current =
      followRef.current === "locked"
        ? (followDistance.current + 1) % FOLLOW_DISTANCE_ZOOMS.length
        : 0;
    choose("locked");
    const zoom = FOLLOW_DISTANCE_ZOOMS[followDistance.current]!;
    hold(FOLLOW_HOLD_MS);
    aim(
      followCamera(
        { ...renderer.getCamera(), zoom },
        point,
        input.current.dimension,
        zoom,
      ),
      { motion: input.current.reducedMotion() ? "immediate" : "eased" },
    );
  }, [aim, choose, hold, renderer]);

  const selectFree = useCallback(() => {
    if (!input.current.enabled || !available("free")) return;
    choose("free");
    const point = input.current.body();
    if (point === undefined) return;
    const current = renderer.getCamera();
    const cycle = freeCycle.current ?? {
      zoom: targetZoom.current ?? current.zoom,
      step: 0,
    };
    const zoom = Math.max(0, cycle.zoom + FREE_DISTANCE_STEPS[cycle.step]!);
    freeCycle.current = {
      zoom: cycle.zoom,
      step: (cycle.step + 1) % FREE_DISTANCE_STEPS.length,
    };
    aim(
      {
        ...current,
        center: [point.longitude, point.latitude],
        zoom,
        pitch: input.current.dimension === "flat" ? 0 : current.pitch,
      },
      { motion: input.current.reducedMotion() ? "immediate" : "eased" },
    );
  }, [aim, available, choose, renderer]);

  // A new identity at the wheel may not offer the mode in use.
  const modesKey = modes.join();
  useEffect(() => {
    if (available(followRef.current)) return;
    if (input.current.enabled) center();
    else choose("locked");
  }, [available, center, choose, modesKey]);

  const advanceTracking = useCallback(
    function advance(nowMs: number) {
      trackingFrame.current = undefined;
      const point = trackedBody.current;
      if (
        point === undefined ||
        !input.current.enabled ||
        followRef.current === "free" ||
        gesturing.current ||
        nowMs < heldUntil.current
      ) {
        stopTracking();
        return;
      }
      const current = renderer.getCamera();
      const locked = followRef.current === "locked";
      const previous = trackingTime.current;
      trackingTime.current = nowMs;
      const elapsed = previous === undefined ? undefined : nowMs - previous;
      const instant = elapsed === undefined || input.current.reducedMotion();
      const subject = activeFocus();
      if (subject !== undefined && glance.current?.key !== subject.key) {
        glance.current = {
          key: subject.key,
          zoom: glance.current?.zoom ?? current.zoom,
          returning: false,
        };
      } else if (subject === undefined && glance.current !== undefined) {
        glance.current = { ...glance.current, returning: true };
      }
      // Coming back from a glance, the usual view comes back at the
      // distance it had before.
      const usual =
        glance.current === undefined
          ? current
          : { ...current, zoom: glance.current.zoom };
      let target: MapCamera;
      let next: MapCamera;
      if (subject !== undefined) {
        target = glanceCamera(current, point, subject, input.current.dimension);
        next = instant ? target : easeCamera(current, target, elapsed!);
      } else {
        target = locked
          ? followCamera(usual, point, input.current.dimension)
          : isometricCamera(usual, point, input.current.dimension);
        if (glance.current !== undefined) {
          next = instant ? target : easeCamera(current, target, elapsed!);
          if (closeToCamera(next, target)) {
            next = target;
            glance.current = undefined;
          }
        } else {
          next = instant
            ? target
            : locked
              ? smoothFollowCamera(
                  current,
                  point,
                  elapsed!,
                  input.current.dimension,
                )
              : smoothIsometricCamera(current, target, elapsed!);
        }
      }
      if (!sameFollowCamera(current, next)) {
        renderer.setCamera(next, { yieldToGesture: true });
      }
      // A glance keeps watching while its subject moves, though the body
      // stands still.
      if (!sameFollowCamera(next, target) || subject !== undefined) {
        trackingFrame.current = globalThis.requestAnimationFrame(advance);
      }
    },
    [activeFocus, renderer, stopTracking],
  );

  const track = useCallback(
    (point: FollowBody) => {
      if (
        !input.current.enabled ||
        followRef.current === "free" ||
        gesturing.current ||
        globalThis.performance.now() < heldUntil.current
      ) {
        return;
      }
      const acquiring = trackedBody.current === undefined;
      trackedBody.current = point;
      if (trackingFrame.current !== undefined) return;
      // Acquisition and reduced motion take the body directly. A step after
      // the glide settled starts a new glide on the next frame; measuring from
      // the last settled frame would turn the time at rest into one jump.
      if (acquiring || input.current.reducedMotion()) {
        advanceTracking(globalThis.performance.now());
        return;
      }
      trackingTime.current = globalThis.performance.now();
      trackingFrame.current = globalThis.requestAnimationFrame(advanceTracking);
    },
    [advanceTracking],
  );

  // A body at rest is only tracked now and then; a subject worth a glance
  // that turns up meanwhile wakes the camera rather than wait for it.
  const hasFocus = focus !== undefined;
  useEffect(() => {
    if (!enabled || !hasFocus) return;
    const check = globalThis.setInterval(() => {
      if (trackingFrame.current !== undefined) return;
      if (activeFocus() === undefined && glance.current === undefined) return;
      const point = input.current.body();
      if (point !== undefined) track(point);
    }, FOCUS_CHECK_MS);
    return () => globalThis.clearInterval(check);
  }, [activeFocus, enabled, hasFocus, track]);

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
          // A person moving the camera looks away from the glance: it is
          // not shown again, and the usual view comes back at its own
          // distance once the gesture ends.
          if (glance.current !== undefined && !glance.current.returning) {
            dismissed.current.add(glance.current.key);
            glance.current = { ...glance.current, returning: true };
          }
          stopTracking();
          gesturing.current = true;
          gestureStart.current = change.camera.zoom;
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
          targetZoom.current = undefined;
          const startZoom = touchStart.current;
          touchStart.current = undefined;
          const gestureZoom = gestureStart.current;
          gestureStart.current = undefined;
          if (!input.current.enabled) return;
          // After manual exploration, start the next Free cycle at that view.
          freeCycle.current = undefined;
          // A person's zoom replaces the chosen preset; it is a distance, not
          // a floor that would snap every later zoom-out back.
          if (gestureZoom !== change.camera.zoom) followDistance.current = -1;
          // A pinch out can detach the camera; zooming in never selects a
          // tracking mode. Only the on-screen mode control selects Isometric.
          if (startZoom !== undefined) {
            const next = followAfterPinch(
              followRef.current,
              startZoom,
              change.camera.zoom,
            );
            // Without Free, pinching out only zooms.
            if (next !== followRef.current && available(next)) {
              choose(next);
              return;
            }
          }
          // Return to the stable game view after orbit/tilt/pan, even when stationary.
          // Free is the mode for keeping an independent viewing angle.
          const point = input.current.body();
          const before = glance.current;
          glance.current = undefined;
          const usual =
            before === undefined
              ? change.camera
              : { ...change.camera, zoom: before.zoom };
          if (
            followRef.current !== "free" &&
            point !== undefined &&
            !sameFollowCamera(change.camera, frameBody(usual, point))
          ) {
            hold(FOLLOW_HOLD_MS);
            aim(frameBody(usual, point), {
              motion: input.current.reducedMotion() ? "immediate" : "eased",
            });
          }
          return;
        }
        // A settled camera has reached its aim, or another move superseded it.
        targetZoom.current = undefined;
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
    [
      aim,
      center,
      choose,
      hold,
      renderer,
      track,
      stopTracking,
      frameBody,
      available,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = cameraKeyCommand(event);
      if (command === undefined) return;
      // Y has nothing to toggle to for an identity without Free.
      if (command === "toggle" && !available("free")) return;
      event.preventDefault();
      // Y leaves Free for Follow. It never re-enters Isometric: that mode
      // is an explicit on-screen selection after the opening default.
      if (command === "toggle" && followRef.current !== "free") {
        choose("free");
      } else {
        center();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [available, center, choose, enabled]);

  return useMemo(
    () => ({
      follow,
      track,
      holdFocus,
      release,
      hold,
      center,
      selectFollow,
      selectFree,
      selectIsometric,
    }),
    [
      center,
      follow,
      hold,
      holdFocus,
      release,
      track,
      selectFollow,
      selectFree,
      selectIsometric,
    ],
  );
}
