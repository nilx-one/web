// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createFailureNotice,
  type FailureKind,
  type FailureNoticeCopy,
  type FailureReport,
} from "./failure-notice";

function report(overrides: Partial<FailureReport> = {}): FailureReport {
  return {
    code: "inference_unavailable",
    kind: "unavailable",
    retryable: true,
    ...overrides,
  };
}

function copy(kind: FailureKind): FailureNoticeCopy {
  return {
    title: `title:${kind}`,
    description: `description:${kind}.`,
    retryLabel: "retry",
  };
}

describe("createFailureNotice", () => {
  it("keeps language outside the application while preserving retry authority", () => {
    const notice = createFailureNotice(
      report({ kind: "unavailable", retryable: true }),
      copy("unavailable"),
    );

    expect(notice).toMatchObject({
      tone: "attention",
      title: "title:unavailable",
      description: "description:unavailable.",
      action: { intent: "retry", label: "retry" },
    });
  });

  it("presents a withheld decision calmly and never invents a retry", () => {
    const notice = createFailureNotice(
      report({ kind: "withheld", retryable: false }),
      copy("withheld"),
    );

    expect(notice.tone).toBe("neutral");
    expect(notice.title).toBe("title:withheld");
    expect(notice.action).toBeUndefined();
  });

  it("maps the closed upstream taxonomy to presentation tone", () => {
    const kinds: readonly FailureKind[] = [
      "unavailable",
      "withheld",
      "gated",
      "rejected",
      "exhausted",
    ];

    const notices = kinds.map((kind) =>
      createFailureNotice(report({ kind, retryable: false }), copy(kind)),
    );

    expect(notices.map((notice) => notice.tone)).toEqual([
      "attention",
      "neutral",
      "neutral",
      "critical",
      "critical",
    ]);
    expect(new Set(notices.map((notice) => notice.title)).size).toBe(
      kinds.length,
    );
  });

  it("treats the retryable flag as the authority rather than the kind", () => {
    expect(
      createFailureNotice(
        report({ kind: "unavailable", retryable: false }),
        copy("unavailable"),
      ).action,
    ).toBeUndefined();
    expect(
      createFailureNotice(
        report({ kind: "withheld", retryable: true }),
        copy("withheld"),
      ).action,
    ).toEqual({ intent: "retry", label: "retry" });
  });

  it("keeps correlation handles out of the localized sentences", () => {
    const notice = createFailureNotice(
      report({
        code: "authority_withheld",
        kind: "withheld",
        retryable: false,
        operation_id: "op-71c",
        session_id: "se-40b",
      }),
      copy("withheld"),
    );

    expect(notice.reference).toBe(
      "code authority_withheld · operation op-71c · session se-40b",
    );
    expect(notice.title).not.toContain("op-71c");
    expect(notice.description).not.toContain("op-71c");
    expect(notice.description).not.toContain("se-40b");
  });

  it("omits absent correlation handles instead of printing placeholders", () => {
    expect(
      createFailureNotice(
        report({ code: "inference_unavailable" }),
        copy("unavailable"),
      ).reference,
    ).toBe("code inference_unavailable");
  });
});
