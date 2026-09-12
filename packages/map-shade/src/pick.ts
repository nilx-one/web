// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  PRESENCE_RESOLUTION,
  type CellIndex,
  type PresenceStore,
  type ShadeSource,
  type VisitRecord,
} from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";

export interface CellTap {
  readonly cell: CellIndex;
  readonly records: readonly VisitRecord[];
}

export function cellAtLngLat(
  lngLat: { readonly lng: number; readonly lat: number },
  resolution = PRESENCE_RESOLUTION,
): CellIndex {
  return latLngToCell(lngLat.lat, lngLat.lng, resolution);
}

export function createTapHandler(options: {
  readonly source: ShadeSource;
  readonly store: PresenceStore;
  readonly resolution?: number;
}): (lngLat: {
  readonly lng: number;
  readonly lat: number;
}) => Promise<CellTap | null> {
  const resolution = options.resolution ?? PRESENCE_RESOLUTION;
  return async (lngLat) => {
    const cell = cellAtLngLat(lngLat, resolution);
    if (!options.source.isLit(cell)) return null;
    return {
      cell,
      records: await options.store.recordsForCell(cell),
    };
  };
}

export function formatRecords(records: readonly VisitRecord[]): string[] {
  return foldVisits(records).map((record) => {
    const entered = new Date(record.enteredAt).toISOString();
    const left =
      record.leftAt === null ? "open" : new Date(record.leftAt).toISOString();
    const duration =
      record.leftAt === null
        ? "—"
        : `${Math.max(0, Math.round((record.leftAt - record.enteredAt) / 60_000))}m`;
    return `${entered}  ${left}  ${duration}  ${record.fixCount} fixes  ±${Math.round(record.bestAccuracyM)}m  ${record.source}`;
  });
}

/**
 * The journal is append-only: a visit lands as an open record when the cell
 * lights and a closing record when the dwell ends. Presentation folds the two
 * halves back into one visit; storage keeps both facts.
 */
export function foldVisits(
  records: readonly VisitRecord[],
): readonly VisitRecord[] {
  const byVisit = new Map<string, VisitRecord>();
  for (const record of records) {
    const key = `${record.cell}:${record.enteredAt}`;
    const existing = byVisit.get(key);
    if (existing === undefined) {
      byVisit.set(key, record);
      continue;
    }
    byVisit.set(key, {
      ...existing,
      leftAt: existing.leftAt ?? record.leftAt,
      fixCount: Math.max(existing.fixCount, record.fixCount),
      bestAccuracyM: Math.min(existing.bestAccuracyM, record.bestAccuracyM),
    });
  }
  return [...byVisit.values()];
}
