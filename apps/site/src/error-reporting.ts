// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BrowserReporter } from "@aiaiaiai/4x-errors-browser";
import type { CoreRuntimeStatus } from "@nilx-one/application";
import type { MapRendererStatus } from "@nilx-one/map-contract";

import type { WipeOutcome } from "./world-wipe";

const MAP_ERROR_IDS: Readonly<Record<string, string>> = {
  "style-load-failed": "map.renderer.style.load.failed",
  "basemap-load-failed": "map.renderer.basemap.load.failed",
  "renderer-init-failed": "map.renderer.init.failed",
  "style-load-timeout": "map.renderer.style.load.timeout",
  "first-paint-timeout": "map.renderer.first.paint.timeout",
  "container-zero-size": "map.renderer.container.zero.size",
  "webgl-unavailable": "map.renderer.webgl.unavailable",
  "webgl-context-lost": "map.renderer.webgl.context.lost",
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

const CORE_RUNTIME_ERROR_IDS: Readonly<Record<string, string>> = {
  "artifact-missing": "core.runtime.artifact.missing",
  "binding-invalid": "core.runtime.binding.invalid",
  "load-failed": "core.runtime.load.failed",
};

// A reason is a closed union today, but mapping by table keeps a reason a later
// Core build adds visible under a generic id instead of silently dropped.
const UNMAPPED_CORE_RUNTIME_ERROR_ID = "core.runtime.unavailable";

// The deterministic Core runtime gates Avaia, the economy and every cutscene
// the drive feeds: when its WebAssembly artifact will not load, those surfaces
// are inert, so the failure is reported once at the composition root rather
// than surfacing only as a dozen downstream symptoms.
export function reportCoreRuntimeStatus(
  reporter: BrowserReporter,
  status: CoreRuntimeStatus,
): void {
  if (status.kind !== "unavailable") {
    return;
  }

  reporter.report({
    errorId:
      CORE_RUNTIME_ERROR_IDS[status.reason] ?? UNMAPPED_CORE_RUNTIME_ERROR_ID,
    severity: "error",
    message: `Core runtime unavailable: ${status.reason}`,
    context: { reason: status.reason },
    tags: ["core", "runtime"],
  });
}

// A wipe that could not finish is retried on the next load, but it must not be
// silent: a device that keeps its old world is exactly what the wipe is for.
export function reportWorldWipe(
  reporter: BrowserReporter,
  outcome: WipeOutcome,
): void {
  if (outcome.status !== "incomplete") {
    return;
  }

  reporter.report({
    errorId: "world.wipe.incomplete",
    severity: "error",
    message: "Local world wipe did not finish",
    context: { failures: outcome.failures.join("; ") },
    tags: ["wipe"],
  });
}
