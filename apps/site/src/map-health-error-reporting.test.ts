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

describe("map health error reporting", () => {
  it.each([
    ["style-load-timeout", "map.renderer.style.load.timeout"],
    ["first-paint-timeout", "map.renderer.first_paint.timeout"],
    ["container-zero-size", "map.renderer.container.zero_size"],
    ["webgl-unavailable", "map.renderer.webgl.unavailable"],
    ["webgl-context-lost", "map.renderer.webgl.context_lost"],
  ] as const)("maps %s into %s", (reason, errorId) => {
    const target = reporter();

    reportMapRendererStatus(target, { kind: "unavailable", reason });

    expect(target.report).toHaveBeenCalledWith(
      expect.objectContaining({
        errorId,
        severity: "error",
        message: `Map renderer unavailable: ${reason}`,
        context: expect.objectContaining({ reason }),
        tags: ["map", "renderer"],
      }),
    );
  });

  it("gives every startup cause its own identifier", () => {
    const reported = (
      [
        "style-load-failed",
        "basemap-load-failed",
        "renderer-init-failed",
        "style-load-timeout",
        "first-paint-timeout",
        "container-zero-size",
        "webgl-unavailable",
        "webgl-context-lost",
      ] as const
    ).map((reason) => {
      const target = reporter();
      reportMapRendererStatus(target, { kind: "unavailable", reason });
      return (target.report as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
        .errorId as string;
    });

    expect(new Set(reported).size).toBe(reported.length);
    expect(reported).not.toContain("map.renderer.unavailable");
  });
});
