// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";
import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";

/** Visible time one startup attempt may take before it offers a retry. */
export const WORLD_STARTUP_TIMEOUT_MS = 20_000;

function pageHidden(): boolean {
  return globalThis.document?.visibilityState === "hidden";
}

export function useWorldStartup(
  renderer: MapRenderer,
  status: MapRendererStatus,
  locating: boolean,
  targetKey: string,
) {
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const waiting =
    !revealed &&
    !failed &&
    status.kind === "ready" &&
    !locating &&
    renderer.whenSceneReady !== undefined;

  // The deadline belongs to the attempt, not to the opening target: a live
  // fix that retargets the wait every second must not keep restarting it,
  // or the retry would never be offered. Only visible time counts, because a
  // hidden page paints no frames and a scene cannot settle while it is away.
  useEffect(() => {
    if (!waiting) return;
    let remaining = WORLD_STARTUP_TIMEOUT_MS;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (timer !== undefined || pageHidden()) return;
      startedAt = globalThis.performance.now();
      timer = globalThis.setTimeout(() => setFailed(true), remaining);
    };
    const pause = () => {
      if (timer === undefined) return;
      globalThis.clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(
        0,
        remaining - (globalThis.performance.now() - startedAt),
      );
    };
    const onVisibility = () => (pageHidden() ? pause() : run());
    globalThis.document?.addEventListener("visibilitychange", onVisibility);
    run();
    return () => {
      pause();
      globalThis.document?.removeEventListener(
        "visibilitychange",
        onVisibility,
      );
    };
  }, [waiting, attempt]);

  useEffect(() => {
    if (!waiting) return;
    const controller = new AbortController();
    const frame = globalThis.requestAnimationFrame(() => {
      void renderer.whenSceneReady!(controller.signal).then(
        () => {
          if (!controller.signal.aborted) setRevealed(true);
        },
        () => {
          if (!controller.signal.aborted) setFailed(true);
        },
      );
    });
    return () => {
      controller.abort();
      globalThis.cancelAnimationFrame(frame);
    };
  }, [renderer, waiting, targetKey, attempt]);

  return {
    ready: status.kind === "ready" && (revealed || !renderer.whenSceneReady),
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}
