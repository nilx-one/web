// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BrowserReporter } from "@aiaiaiai/4x-errors-browser";
import type { MapRendererStatus } from "@nilx-one/map-contract";

const MAP_ERROR_IDS = {
  "style-load-failed": "map.renderer.style_load.failed",
  "basemap-load-failed": "map.renderer.basemap_load.failed",
  "renderer-init-failed": "map.renderer.init.failed",
} as const;

export function reportMapRendererStatus(
  reporter: BrowserReporter,
  status: MapRendererStatus,
): void {
  if (status.kind !== "unavailable") {
    return;
  }

  reporter.report({
    errorId: MAP_ERROR_IDS[status.reason],
    severity: "error",
    message: `Map renderer unavailable: ${status.reason}`,
    context: { reason: status.reason },
    tags: ["map", "renderer"],
  });
}
