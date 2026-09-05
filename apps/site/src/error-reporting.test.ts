// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BrowserReporter } from "@aiaiaiai/4x-errors-browser";
import { describe, expect, it, vi } from "vitest";

import { reportMapRendererStatus } from "./error-reporting";

function reporter(): BrowserReporter {
  return {
    report: vi.fn(),
    flush: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

describe("reportMapRendererStatus", () => {
  it("still reports a reason the table has not learned yet", () => {
    const target = reporter();

    reportMapRendererStatus(target, {
      kind: "unavailable",
      reason: "webgl2-unsupported",
    });

    expect(target.report).toHaveBeenCalledWith(
      expect.objectContaining({ errorId: "map.renderer.unavailable" }),
    );
  });

  it("does not report healthy renderer states", () => {
    const target = reporter();

    reportMapRendererStatus(target, { kind: "ready" });

    expect(target.report).not.toHaveBeenCalled();
  });

  it.each([
    ["style-load-failed", "map.renderer.style_load.failed"],
    ["basemap-load-failed", "map.renderer.basemap_load.failed"],
    ["renderer-init-failed", "map.renderer.init.failed"],
  ] as const)("maps %s into errors.v1 semantic id %s", (reason, errorId) => {
    const target = reporter();

    reportMapRendererStatus(target, { kind: "unavailable", reason });

    expect(target.report).toHaveBeenCalledWith({
      errorId,
      severity: "error",
      message: `Map renderer unavailable: ${reason}`,
      context: { reason },
      tags: ["map", "renderer"],
    });
  });
});
