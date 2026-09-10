// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { VisitRecord } from "./index";

/**
 * One journal record, flattened to strings.
 *
 * Phase 1 shows the journal raw, one row per record, and reads it rather than
 * narrating it. Nothing here interprets a visit, folds an open record together
 * with its closing record, or decides what a place meant — those are the
 * questions a week of real walking is supposed to answer, not this function.
 */
export interface JournalRow {
  readonly cell: string;
  readonly entered: string;
  readonly left: string;
  readonly dwell: string;
  readonly fixes: string;
  readonly bestAccuracy: string;
}

const OPEN = "—";

/** ISO 8601, UTC. A local-time rendering is a Phase 2 question. */
export function formatInstant(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    return OPEN;
  }
  return new Date(epochMs).toISOString();
}

/** Whole seconds under a minute, then `MMmSSs`, then `HHhMMm`. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return OPEN;
  }
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m${String(totalSeconds % 60).padStart(2, "0")}s`;
  }
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

export function toJournalRow(record: VisitRecord): JournalRow {
  return {
    cell: record.cell,
    entered: formatInstant(record.enteredAt),
    left: record.leftAt === null ? OPEN : formatInstant(record.leftAt),
    dwell:
      record.leftAt === null
        ? "open"
        : formatDuration(record.leftAt - record.enteredAt),
    fixes: String(record.fixCount),
    bestAccuracy: `${Math.round(record.bestAccuracyM)}m`,
  };
}

export function toJournalRows(
  records: readonly VisitRecord[],
): readonly JournalRow[] {
  return [...records]
    .sort((left, right) => left.enteredAt - right.enteredAt)
    .map(toJournalRow);
}
