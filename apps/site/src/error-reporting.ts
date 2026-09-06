// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BrowserReporter } from "@aiaiaiai/4x-errors-browser";
import type { MapRendererStatus } from "@nilx-one/map-contract";

const MAP_ERROR_IDS: Readonly<Record<string, string>> = {
  "style-load-failed": "map.renderer.style.load.failed",
  "basemap-load-failed": "map.renderer.basemap.load.failed",
  "renderer-init-failed": "map.renderer.init.failed",
  "load-timeout": "map.renderer.load.timeout",
  "container-zero-size": "map.renderer.container.zero_size",
  "webgl-context-lost": "map.renderer.webgl.context_lost",
};

// A renderer reason is a plain string in the contract, so the adapter may name
// one this table has not learned yet. Reporting it under a generic id keeps a
// new failure visible; dropping it would make the newest failures the quietest.
const UNMAPPED_MAP_ERROR_ID = "map.renderer.unavailable";

export function reportMapRendererStatus(
  reporter: BrowserReporter,
  status: MapRendererStatus,
): void {
  if (status.kind !== "unavailable") {
    return;
  }

  reporter.report({
    errorId: MAP_ERROR_IDS[status.reason] ?? UNMAPPED_MAP_ERROR_ID,
    severity: "error",
    message: `Map renderer unavailable: ${status.reason}`,
    context: { reason: status.reason },
    tags: ["map", "renderer"],
  });
}
