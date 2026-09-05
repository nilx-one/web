// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  FAILURE_RECORD_CONTRACT_VERSION,
  createFailureRecord,
} from "./failure-record";

const report = {
  code: "style-load-failed",
  kind: "unavailable",
  retryable: true,
} as const;

describe("createFailureRecord", () => {
  it("stamps this build's contract line rather than one a caller supplies", () => {
    const record = createFailureRecord({
      report,
      surface: "web-client",
      component: "map-renderer",
      recordedAtUnixMs: 1_767_225_600_000,
    });

    expect(record).toEqual({
      contract_version: FAILURE_RECORD_CONTRACT_VERSION,
      recorded_at_unix_ms: 1_767_225_600_000,
      surface: "web-client",
      component: "map-renderer",
      code: "style-load-failed",
      kind: "unavailable",
      retryable: true,
    });
  });

  it("copies the upstream classification instead of re-deriving it", () => {
    const record = createFailureRecord({
      report: {
        code: "authority_withheld",
        kind: "withheld",
        retryable: false,
      },
      surface: "web-host",
      component: "identity",
      recordedAtUnixMs: 1,
    });

    expect(record.kind).toBe("withheld");
    expect(record.retryable).toBe(false);
  });

  it("omits absent columns rather than writing them empty", () => {
    const record = createFailureRecord({
      report,
      surface: "web-client",
      component: "map-renderer",
      recordedAtUnixMs: 1,
    });

    expect(Object.keys(record)).not.toContain("release");
    expect(Object.keys(record)).not.toContain("session_id");
    expect(Object.keys(record)).not.toContain("context");
  });

  it("carries correlation and release when the surface knows them", () => {
    const record = createFailureRecord({
      report: { ...report, session_id: "s-1", operation_id: "o-1" },
      surface: "web-client",
      component: "map-renderer",
      recordedAtUnixMs: 1,
      release: "969565f",
      context: { appearance: "dark" },
    });

    expect(record).toMatchObject({
      session_id: "s-1",
      operation_id: "o-1",
      release: "969565f",
      context: { appearance: "dark" },
    });
  });

  it("never carries a subject identifier", () => {
    const record = createFailureRecord({
      report,
      surface: "web-client",
      component: "map-renderer",
      recordedAtUnixMs: 1,
    });

    // A durable table keyed by the person a runtime acts for is a different
    // artifact with a different retention contract.
    expect(JSON.stringify(record)).not.toMatch(/pub_dress|subject/i);
  });
});
