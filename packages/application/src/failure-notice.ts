// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The already-classified failure report handed to this client by the 0x1 AI
 * runtime. `kind` and `retryable` are decided upstream against a closed
 * taxonomy owned by the shared foundation; the client never re-derives them
 * from `code`, and never treats `code` as anything but an opaque handle.
 */
export type FailureKind =
  "unavailable" | "withheld" | "gated" | "rejected" | "exhausted";

export interface FailureReport {
  readonly code: string;
  readonly kind: FailureKind;
  readonly retryable: boolean;
  readonly operation_id?: string;
  readonly session_id?: string;
}

/** Presentation vocabulary owned by this client, not a mirror of `kind`. */
export type FailureNoticeTone = "attention" | "critical" | "neutral";

export interface FailureNoticeAction {
  readonly intent: "retry";
  readonly label: string;
}

export interface FailureNotice {
  readonly title: string;
  readonly tone: FailureNoticeTone;
  readonly description: string;
  readonly action?: FailureNoticeAction;
  readonly reference?: string;
}

interface FailureCopy {
  readonly title: string;
  readonly tone: FailureNoticeTone;
  readonly description: string;
}

function copyForKind(kind: FailureKind): FailureCopy {
  switch (kind) {
    case "unavailable":
      return {
        tone: "attention",
        title: "Request unanswered",
        description:
          "Nothing could answer this request, so nothing was decided and nothing was substituted.",
      };
    case "withheld":
      return {
        tone: "neutral",
        title: "Declined by authority",
        description:
          "Authority was asked and the answer was no; this is a decision, not a malfunction.",
      };
    case "gated":
      return {
        tone: "neutral",
        title: "Not acting right now",
        description:
          "The runtime is dormant or winding down, so it is not acting in its current mode.",
      };
    case "rejected":
      return {
        tone: "critical",
        title: "Request rejected",
        description:
          "The request contradicted the contract and was refused; an operator needs to look at this.",
      };
    case "exhausted":
      return {
        tone: "critical",
        title: "Limit reached",
        description:
          "A counter for this operation hit its ceiling; an operator needs to look at this.",
      };
  }
}

function reference(report: FailureReport): string {
  return [
    `code ${report.code}`,
    report.operation_id === undefined
      ? undefined
      : `operation ${report.operation_id}`,
    report.session_id === undefined
      ? undefined
      : `session ${report.session_id}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

/**
 * Projects one upstream failure report onto the toast surface. A retry
 * affordance is offered when — and only when — the runtime marked the failure
 * retryable; the client never infers retryability from the kind or the code.
 */
export function createFailureNotice(report: FailureReport): FailureNotice {
  const copy = copyForKind(report.kind);

  return {
    ...copy,
    reference: reference(report),
    ...(report.retryable
      ? { action: { intent: "retry" as const, label: "Try again" } }
      : {}),
  };
}
