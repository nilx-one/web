// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createFailureNotice,
  type FailureKind,
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

describe("createFailureNotice", () => {
  it("asks a person to try again only when the runtime marked the failure retryable", () => {
    const notice = createFailureNotice(
      report({
        code: "inference_unavailable",
        kind: "unavailable",
        retryable: true,
      }),
    );

    expect(notice).toMatchObject({
      tone: "attention",
      title: "Request unanswered",
      action: { intent: "retry", label: "Try again" },
    });
    expect(notice.description).toBe(
      "Nothing could answer this request, so nothing was decided and nothing was substituted.",
    );
  });

  it("presents a withheld decision calmly and never offers to ask again", () => {
    const notice = createFailureNotice(
      report({
        code: "authority_withheld",
        kind: "withheld",
        retryable: false,
      }),
    );

    expect(notice.tone).toBe("neutral");
    expect(notice.title).toBe("Declined by authority");
    expect(notice.description).toBe(
      "Authority was asked and the answer was no; this is a decision, not a malfunction.",
    );
    expect(notice.action).toBeUndefined();
  });

  it("explains a gated runtime as a mode rather than a fault", () => {
    const notice = createFailureNotice(
      report({ code: "runtime_dormant", kind: "gated", retryable: false }),
    );

    expect(notice).toMatchObject({
      tone: "neutral",
      title: "Not acting right now",
    });
    expect(notice.description).toBe(
      "The runtime is dormant or winding down, so it is not acting in its current mode.",
    );
  });

  it("routes a contract rejection to an operator", () => {
    const notice = createFailureNotice(
      report({ code: "contract_rejected", kind: "rejected", retryable: false }),
    );

    expect(notice).toMatchObject({
      tone: "critical",
      title: "Request rejected",
    });
    expect(notice.description).toBe(
      "The request contradicted the contract and was refused; an operator needs to look at this.",
    );
  });

  it("routes an exhausted counter to an operator", () => {
    const notice = createFailureNotice(
      report({ code: "budget_exhausted", kind: "exhausted", retryable: false }),
    );

    expect(notice).toMatchObject({
      tone: "critical",
      title: "Limit reached",
    });
    expect(notice.description).toBe(
      "A counter for this operation hit its ceiling; an operator needs to look at this.",
    );
  });

  it("covers every kind in the upstream taxonomy with one tone and one sentence", () => {
    const kinds: readonly FailureKind[] = [
      "unavailable",
      "withheld",
      "gated",
      "rejected",
      "exhausted",
    ];

    const notices = kinds.map((kind) =>
      createFailureNotice(report({ kind, retryable: false })),
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
    for (const notice of notices) {
      expect(notice.description.endsWith(".")).toBe(true);
    }
  });

  it("treats the retryable flag as the authority rather than the kind", () => {
    expect(
      createFailureNotice(report({ kind: "unavailable", retryable: false }))
        .action,
    ).toBeUndefined();
    expect(
      createFailureNotice(report({ kind: "withheld", retryable: true })).action,
    ).toEqual({ intent: "retry", label: "Try again" });
  });

  it("keeps correlation handles out of the sentences a person reads", () => {
    const notice = createFailureNotice(
      report({
        code: "authority_withheld",
        kind: "withheld",
        retryable: false,
        operation_id: "op-71c",
        session_id: "se-40b",
      }),
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
      createFailureNotice(report({ code: "inference_unavailable" })).reference,
    ).toBe("code inference_unavailable");
  });
});
