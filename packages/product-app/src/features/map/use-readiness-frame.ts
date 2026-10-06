// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import type { WorldReadinessTone } from "./world-readiness";

/** How long a frame that says "all is well" stays before it fades. */
export const READINESS_FRAME_SETTLE_MS = 5000;

/** A good answer is said briefly; a problem or an open question stays said. */
function settles(tone: WorldReadinessTone): boolean {
  return tone === "ready" || tone === "connected";
}

/**
 * Whether the frame is shown. A tone that settles is shown for
 * `READINESS_FRAME_SETTLE_MS` and then fades; any change of tone shows the
 * frame again, so a model that arrives later still gets its green moment.
 */
export function useReadinessFrameVisible(tone: WorldReadinessTone): boolean {
  const [faded, setFaded] = useState<WorldReadinessTone | undefined>(undefined);

  useEffect(() => {
    if (!settles(tone)) return;
    const fades = globalThis.setTimeout(
      () => setFaded(tone),
      READINESS_FRAME_SETTLE_MS,
    );
    return () => globalThis.clearTimeout(fades);
  }, [tone]);

  return faded !== tone;
}
