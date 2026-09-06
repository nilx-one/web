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
    ["load-timeout", "map.renderer.load.timeout"],
    ["container-zero-size", "map.renderer.container.zero_size"],
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
});
