// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { mapRendererFailureReport } from "./map-failure-report";

describe("mapRendererFailureReport", () => {
  it("records nothing for a renderer that is working or still starting", () => {
    expect(mapRendererFailureReport({ kind: "ready" })).toBeUndefined();
    expect(mapRendererFailureReport({ kind: "loading" })).toBeUndefined();
    expect(mapRendererFailureReport({ kind: "unmounted" })).toBeUndefined();
  });

  it("treats a missing asset as retryable, since publishing one would fix it", () => {
    for (const reason of ["style-load-failed", "basemap-load-failed"]) {
      expect(mapRendererFailureReport({ kind: "unavailable", reason })).toEqual(
        { code: reason, kind: "unavailable", retryable: true },
      );
    }
  });

  it("treats a client that cannot start the renderer as not retryable", () => {
    expect(
      mapRendererFailureReport({
        kind: "unavailable",
        reason: "renderer-init-failed",
      }),
    ).toEqual({
      code: "renderer-init-failed",
      kind: "unavailable",
      retryable: false,
    });
  });
});
