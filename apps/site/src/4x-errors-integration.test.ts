// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createBrowserReporter,
  type ErrorEventV1,
} from "@aiaiaiai/4x-errors-browser";
import { describe, expect, it } from "vitest";

import { reportMapRendererStatus } from "./error-reporting";

describe("@aiaiaiai/4x-errors-browser integration", () => {
  it("projects an explicit map failure into a canonical errors.v1 browser event", async () => {
    const events: ErrorEventV1[] = [];
    const reporter = createBrowserReporter({
      project: "nilx-one/web",
      source: "browser",
      transport: (event) => {
        events.push(event);
      },
      captureGlobalErrors: false,
      now: () => new Date("2026-09-06T00:00:00.000Z"),
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });

    reportMapRendererStatus(reporter, {
      kind: "unavailable",
      reason: "style-load-failed",
    });
    await reporter.flush();

    expect(events).toEqual([
      expect.objectContaining({
        protocol_version: "errors.v1",
        event_id: "00000000-0000-4000-8000-000000000001",
        error_id: "map.renderer.style.load.failed",
        project: "nilx-one/web",
        source: "browser",
        severity: "error",
        context: { reason: "style-load-failed" },
        tags: ["map", "renderer"],
      }),
    ]);

    reporter.dispose();
  });
});
