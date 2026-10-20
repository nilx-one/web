// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

/**
 * A presentation-only gate for new on-device inference. It never changes
 * Avaia's intent, the Core drive, her state, or any protocol fact.
 */
export type InferencePerformanceMode = "normal" | "degraded" | "critical";

export interface InferencePerformanceState {
  readonly mode: InferencePerformanceMode;
  readonly slow: number;
  readonly severe: number;
  readonly recovery: number;
}

/**
 * Conservative one-second window thresholds. They are about browser frame
 * delivery, not a claimed measurement of GPU utilization or device memory.
 */
export const INFERENCE_FPS = {
  degradedBelow: 36,
  criticalBelow: 20,
  recoverDegradedAt: 36,
  recoverNormalAt: 50,
} as const;

export const INFERENCE_WINDOWS = {
  enterDegraded: 3,
  enterCritical: 2,
  leaveCritical: 5,
  leaveDegraded: 5,
} as const;

export function inferencePerformanceState(
  mode: InferencePerformanceMode = "normal",
): InferencePerformanceState {
  return { mode, slow: 0, severe: 0, recovery: 0 };
}

/** Hysteresis: a brief hiccup cannot start an unload/reload loop. */
export function observeInferencePerformance(
  previous: InferencePerformanceState,
  fps: number,
): InferencePerformanceState {
  if (!Number.isFinite(fps) || fps < 0) return previous;

  if (previous.mode === "critical") {
    const recovery =
      fps >= INFERENCE_FPS.recoverDegradedAt ? previous.recovery + 1 : 0;
    return recovery >= INFERENCE_WINDOWS.leaveCritical
      ? inferencePerformanceState("degraded")
      : { ...previous, recovery };
  }

  const severe = fps < INFERENCE_FPS.criticalBelow ? previous.severe + 1 : 0;
  if (severe >= INFERENCE_WINDOWS.enterCritical) {
    return inferencePerformanceState("critical");
  }

  if (previous.mode === "degraded") {
    const recovery =
      fps >= INFERENCE_FPS.recoverNormalAt ? previous.recovery + 1 : 0;
    return recovery >= INFERENCE_WINDOWS.leaveDegraded
      ? inferencePerformanceState("normal")
      : { ...previous, severe, recovery };
  }

  const slow = fps < INFERENCE_FPS.degradedBelow ? previous.slow + 1 : 0;
  return slow >= INFERENCE_WINDOWS.enterDegraded
    ? inferencePerformanceState("degraded")
    : { ...previous, slow, severe };
}

/**
 * Measure delivered animation frames only while Avaia has a cached model and
 * the map is active. The browser throttles hidden tabs, so visibility is an
 * explicit pause, never evidence of slow GPU performance. No network or model
 * download is started by this observer.
 */
export function useInferencePerformance(
  active: boolean,
): InferencePerformanceMode {
  const [mode, setMode] = useState<InferencePerformanceMode>(() =>
    typeof document !== "undefined" && document.visibilityState !== "visible"
      ? "critical"
      : "normal",
  );

  useEffect(() => {
    if (
      !active ||
      typeof document === "undefined" ||
      typeof globalThis.requestAnimationFrame !== "function"
    ) {
      return;
    }

    let state = inferencePerformanceState(
      document.visibilityState === "visible" ? "normal" : "critical",
    );
    let frameId: number | undefined;
    let windowStart: number | undefined;
    let frameCount = 0;
    let stopped = false;

    const publish = () => {
      if (!stopped) setMode(state.mode);
    };

    const frame = (at: number) => {
      if (stopped || document.visibilityState !== "visible") return;
      if (windowStart === undefined) {
        windowStart = at;
      } else {
        frameCount += 1;
        const elapsed = at - windowStart;
        if (elapsed >= 1_000) {
          // A multi-second main-thread stall must not trigger GPU inference.
          // It is not treated as a fabricated per-frame FPS reading.
          state =
            elapsed > 2_500
              ? inferencePerformanceState("critical")
              : observeInferencePerformance(
                  state,
                  (frameCount * 1_000) / elapsed,
                );
          windowStart = at;
          frameCount = 0;
          publish();
        }
      }
      frameId = globalThis.requestAnimationFrame(frame);
    };

    const stopFrames = () => {
      if (frameId !== undefined) globalThis.cancelAnimationFrame(frameId);
      frameId = undefined;
      windowStart = undefined;
      frameCount = 0;
    };

    const visibilityChanged = () => {
      stopFrames();
      if (document.visibilityState !== "visible") {
        state = inferencePerformanceState("critical");
        publish();
      } else {
        // Keep the critical gate until a sustained, measured recovery.
        frameId = globalThis.requestAnimationFrame(frame);
      }
    };

    document.addEventListener("visibilitychange", visibilityChanged);
    if (document.visibilityState === "visible") {
      frameId = globalThis.requestAnimationFrame(frame);
    } else {
      // Schedule rather than update React state synchronously in an effect.
      void Promise.resolve().then(publish);
    }

    return () => {
      stopped = true;
      stopFrames();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [active]);

  return active ? mode : "normal";
}
