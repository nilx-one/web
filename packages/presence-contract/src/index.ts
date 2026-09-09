// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Opaque H3 cell index. Concrete H3 operations stay in adapters. */
export type CellIndex = string;

/** Phase 1 presence granularity. Tuned by the walking acceptance period. */
export const PRESENCE_RESOLUTION = 9;
/** Fixes less accurate than this are not evidence for a cell visit. */
export const PRESENCE_ACCURACY_GATE_M = 50;
/** A cell must retain an accepted observation for this long before it lights. */
export const PRESENCE_DWELL_MS = 60_000;

export interface VisitRecord {
  readonly cell: CellIndex;
  readonly enteredAt: number;
  readonly leftAt: number | null;
  readonly source: "self";
  readonly fixCount: number;
  readonly bestAccuracyM: number;
}

/**
 * Personal, device-local append-only journal. It is not BondChain evidence and
 * has no sync or network operation in its contract.
 */
export interface PresenceStore {
  append(record: VisitRecord): Promise<void>;
  listCells(): Promise<readonly CellIndex[]>;
  recordsForCell(cell: CellIndex): Promise<readonly VisitRecord[]>;
  subscribe(onAppend: (record: VisitRecord) => void): () => void;
}

/**
 * The renderer sees membership only. Journal contents remain reachable solely
 * through the explicit cell-activation path.
 */
export interface ShadeSource {
  litCells(): readonly CellIndex[];
  isLit(cell: CellIndex): boolean;
  onCellLit(listener: (cell: CellIndex) => void): () => void;
}

/** Host observation copied into the zero-dependency presence boundary. */
export interface PresenceObservation {
  readonly longitude: number;
  readonly latitude: number;
  readonly accuracyMeters: number;
  readonly observedAt: number;
}

/** Consumes observations; it never owns or starts a platform location API. */
export interface PresenceTracker {
  observe(observation: PresenceObservation): void;
  stop(): void;
}
