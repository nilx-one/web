// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FailureReport } from "@nilx-one/application";
import type { MapRendererStatus } from "@nilx-one/map-contract";

/**
 * Classifies a renderer failure against the shared taxonomy.
 *
 * Every reason here is `unavailable`: nothing about the map was decided
 * wrongly, something the projection needs could not answer. They differ in
 * whether the same load, unchanged, could succeed — an asset that is missing
 * now may be published later, while a client that cannot start WebGL2 will
 * not start it on a retry.
 */
export function mapRendererFailureReport(
  status: MapRendererStatus,
): FailureReport | undefined {
  if (status.kind !== "unavailable") {
    return undefined;
  }

  return {
    code: status.reason,
    kind: "unavailable",
    retryable: status.reason !== "renderer-init-failed",
  };
}
