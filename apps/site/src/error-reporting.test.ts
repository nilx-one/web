// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BrowserReporter } from "@aiaiaiai/4x-errors-browser";
import { describe, expect, it, vi } from "vitest";

import {
  reportCoreRuntimeStatus,
  reportMapRendererStatus,
} from "./error-reporting";

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
    ["style-load-failed", "map.renderer.style.load.failed"],
    ["basemap-load-failed", "map.renderer.basemap.load.failed"],
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

describe("reportCoreRuntimeStatus", () => {
  it("does not report a ready runtime", () => {
    const target = reporter();

    reportCoreRuntimeStatus(target, {
      kind: "ready",
      contractVersion: "0.1.0",
    });

    expect(target.report).not.toHaveBeenCalled();
  });

  it.each([
    ["artifact-missing", "core.runtime.artifact.missing"],
    ["binding-invalid", "core.runtime.binding.invalid"],
    ["load-failed", "core.runtime.load.failed"],
  ] as const)("maps %s into errors.v1 semantic id %s", (reason, errorId) => {
    const target = reporter();

    reportCoreRuntimeStatus(target, { kind: "unavailable", reason });

    expect(target.report).toHaveBeenCalledWith({
      errorId,
      severity: "error",
      message: `Core runtime unavailable: ${reason}`,
      context: { reason },
      tags: ["core", "runtime"],
    });
  });

  it("still reports a reason the table has not learned yet", () => {
    const target = reporter();

    reportCoreRuntimeStatus(target, {
      kind: "unavailable",
      reason: "sandbox-denied" as never,
    });

    expect(target.report).toHaveBeenCalledWith(
      expect.objectContaining({ errorId: "core.runtime.unavailable" }),
    );
  });
});
