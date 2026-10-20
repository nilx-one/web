// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  inferencePerformanceState,
  observeInferencePerformance,
  type InferencePerformanceState,
} from "./inference-performance";

function windows(
  state: InferencePerformanceState,
  fps: number,
  count: number,
): InferencePerformanceState {
  let next = state;
  for (let index = 0; index < count; index += 1) {
    next = observeInferencePerformance(next, fps);
  }
  return next;
}

describe("Avaia's browser inference performance gate", () => {
  it("ignores a short frame-rate dip and does not flap at the threshold", () => {
    const normal = inferencePerformanceState();
    expect(windows(normal, 15, 1).mode).toBe("normal");
    expect(windows(normal, 30, 2).mode).toBe("normal");
    expect(observeInferencePerformance(windows(normal, 30, 2), 60).mode).toBe(
      "normal",
    );
  });

  it("defers inference after sustained slow frames", () => {
    const degraded = windows(inferencePerformanceState(), 30, 3);
    expect(degraded.mode).toBe("degraded");
    expect(windows(degraded, 49, 10).mode).toBe("degraded");
    expect(windows(degraded, 55, 4).mode).toBe("degraded");
    expect(windows(degraded, 55, 5).mode).toBe("normal");
  });

  it("suspends on severe frames and recovers in two stable stages", () => {
    const critical = windows(inferencePerformanceState(), 15, 2);
    expect(critical.mode).toBe("critical");
    expect(windows(critical, 55, 4).mode).toBe("critical");
    const degraded = windows(critical, 55, 5);
    expect(degraded.mode).toBe("degraded");
    expect(windows(degraded, 55, 5).mode).toBe("normal");
  });

  it("can escalate from degraded and does not count interrupted recovery", () => {
    const degraded = windows(inferencePerformanceState(), 30, 3);
    expect(windows(degraded, 10, 2).mode).toBe("critical");
    const nearlyRecovered = windows(degraded, 55, 4);
    expect(windows(observeInferencePerformance(nearlyRecovered, 30), 55, 1).mode).toBe(
      "degraded",
    );
  });

  it("keeps background state distinct from FPS and ignores invalid samples", () => {
    const paused = inferencePerformanceState("critical");
    expect(observeInferencePerformance(paused, Number.NaN)).toBe(paused);
    expect(observeInferencePerformance(paused, -1)).toBe(paused);
    expect(windows(paused, 0, 60).mode).toBe("critical");
    expect(windows(paused, 60, 5).mode).toBe("degraded");
  });
});
