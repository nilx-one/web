// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The already-classified failure report handed to this client by the 0x1 AI
 * runtime. `kind` and `retryable` are decided upstream against a closed
 * taxonomy owned by the shared foundation; the client never re-derives them
 * from `code`, and never treats `code` as anything but an opaque handle.
 */
export type FailureKind =
  | "unavailable"
  | "withheld"
  | "gated"
  | "rejected"
  | "exhausted";

export interface FailureReport {
  readonly code: string;
  readonly kind: FailureKind;
  readonly retryable: boolean;
  readonly operation_id?: string;
  readonly session_id?: string;
}

/** Presentation vocabulary owned by the client, not a mirror of `kind`. */
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

/** Human-facing copy is injected by the presentation boundary that owns locale. */
export interface FailureNoticeCopy {
  readonly title: string;
  readonly description: string;
  readonly retryLabel: string;
}

function toneForKind(kind: FailureKind): FailureNoticeTone {
  switch (kind) {
    case "unavailable":
      return "attention";
    case "withheld":
    case "gated":
      return "neutral";
    case "rejected":
    case "exhausted":
      return "critical";
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
 * Projects one upstream failure report onto the toast surface. The application
 * owns semantic tone, correlation reference, and retry intent; the rendering
 * frontend supplies localized words. Retry is still offered when — and only
 * when — the runtime marked the report retryable.
 */
export function createFailureNotice(
  report: FailureReport,
  copy: FailureNoticeCopy,
): FailureNotice {
  return {
    tone: toneForKind(report.kind),
    title: copy.title,
    description: copy.description,
    reference: reference(report),
    ...(report.retryable
      ? {
          action: {
            intent: "retry" as const,
            label: copy.retryLabel,
          },
        }
      : {}),
  };
}
