// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";
import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";

export function useWorldStartup(
  renderer: MapRenderer,
  status: MapRendererStatus,
  locating: boolean,
  targetKey: string,
) {
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (
      revealed ||
      status.kind !== "ready" ||
      locating ||
      !renderer.whenSceneReady
    )
      return;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => {
      controller.abort();
      setFailed(true);
    }, 20_000);
    const frame = globalThis.requestAnimationFrame(() => {
      void renderer.whenSceneReady!(controller.signal).then(
        () => {
          if (!controller.signal.aborted) {
            globalThis.clearTimeout(timeout);
            setRevealed(true);
          }
        },
        () => {
          if (!controller.signal.aborted) {
            globalThis.clearTimeout(timeout);
            setFailed(true);
          }
        },
      );
    });
    return () => {
      controller.abort();
      globalThis.clearTimeout(timeout);
      globalThis.cancelAnimationFrame(frame);
    };
  }, [renderer, status.kind, locating, targetKey, revealed, attempt]);
  return {
    ready: status.kind === "ready" && (revealed || !renderer.whenSceneReady),
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((value) => value + 1);
    },
  };
}
