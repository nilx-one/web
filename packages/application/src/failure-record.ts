// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FailureKind, FailureReport } from "./failure-notice";

export const FAILURE_RECORD_CONTRACT_VERSION = "0.1.0";

/**
 * Where a failure was observed. A record is only ever as trustworthy as the
 * surface that wrote it, so the surface is part of the row rather than
 * something a reader infers from the other columns.
 */
export type FailureSurface = "web-client" | "web-host";

/**
 * The row a product stores. Every 0x1 surface writes the same columns, so a
 * reader moving between two failure tables is reading the same thing.
 *
 * No subject identifier appears here on purpose. `session_id` and
 * `operation_id` correlate a record with the work that produced it; a durable
 * table keyed by the person a runtime acts for is a different artifact with a
 * different retention contract, and a failure table is not a way around that.
 */
export interface FailureRecord {
  readonly contract_version: string;
  readonly recorded_at_unix_ms: number;
  readonly surface: FailureSurface;
  readonly component: string;
  readonly code: string;
  readonly kind: FailureKind;
  readonly retryable: boolean;
  readonly release?: string;
  readonly session_id?: string;
  readonly operation_id?: string;
  readonly context?: Readonly<Record<string, string>>;
}

export interface FailureRecordInput {
  readonly report: FailureReport;
  readonly surface: FailureSurface;
  readonly component: string;
  readonly recordedAtUnixMs: number;
  readonly release?: string;
  readonly context?: Readonly<Record<string, string>>;
}

/**
 * Somewhere to send a record. Recording is best effort by construction: a sink
 * that can fail loudly would turn one failure into two.
 */
export interface FailureSinkPort {
  record(record: FailureRecord): void;
}

/**
 * Builds a record for an already-classified report.
 *
 * The contract version is this build's, never one a caller supplies: a record
 * claiming another line would misdescribe the vocabulary its own code came
 * from. `kind` and `retryable` are copied, never re-derived — the taxonomy is
 * owned upstream and a surface that recomputed it would drift from it.
 */
export function createFailureRecord(input: FailureRecordInput): FailureRecord {
  // Absent columns are omitted rather than written as null, so a reader can
  // tell "this surface had nothing to say" from "this surface said nothing".
  return {
    contract_version: FAILURE_RECORD_CONTRACT_VERSION,
    recorded_at_unix_ms: input.recordedAtUnixMs,
    surface: input.surface,
    component: input.component,
    code: input.report.code,
    kind: input.report.kind,
    retryable: input.report.retryable,
    ...(input.release === undefined ? {} : { release: input.release }),
    ...(input.report.session_id === undefined
      ? {}
      : { session_id: input.report.session_id }),
    ...(input.report.operation_id === undefined
      ? {}
      : { operation_id: input.report.operation_id }),
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}
