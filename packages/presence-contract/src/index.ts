// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Presence is the record of where a person has physically been. It is local
 * evidence: it stays on the device that observed it, it is never Bond,
 * BondChain, Relationship, or shared-world truth, and it never reaches a
 * backend, analytics, or an error report.
 *
 * This contract stays free of DOM types, of H3, and of any renderer, so a
 * native host or a headless test can implement it without a browser.
 */

/**
 * An opaque H3 index. Deliberately opaque: nothing outside the adapters that
 * own H3 may parse, compare geographically, or derive coordinates from it.
 */
export type CellIndex = string;

/**
 * The H3 resolution presence is recorded at. Resolution 9 averages roughly
 * 174 m across, which is close to the honest limit of a consumer GPS fix: fine
 * enough that a cell means a place, coarse enough that it does not mean an
 * address.
 */
export const PRESENCE_RESOLUTION = 9;

/**
 * Where a visit record came from. Phase 1 records only what this device
 * observed for its own owner; a second origin arrives with its own contract.
 */
export type VisitSource = "self";

export interface VisitRecord {
  readonly cell: CellIndex;
  /** Host clock reading for the first accepted fix in this cell, in ms. */
  readonly enteredAt: number;
  /**
   * When the visit closed, or null while it is still open. An open record is
   * appended the moment a cell is earned; the closing record is appended on
   * the way out, because the journal is append-only and never rewrites.
   */
  readonly leftAt: number | null;
  readonly source: VisitSource;
  /** How many fixes passed the accuracy gate inside this visit. */
  readonly fixCount: number;
  /** The smallest horizontal uncertainty seen during this visit, in metres. */
  readonly bestAccuracyM: number;
}

/**
 * The journal. Append-only by contract: there is no update and no delete, so a
 * visit that has already been written can never be quietly revised.
 */
export interface PresenceStore {
  append(record: VisitRecord): Promise<void>;
  listCells(): Promise<CellIndex[]>;
  recordsForCell(cell: CellIndex): Promise<readonly VisitRecord[]>;
  subscribe(onAppend: (record: VisitRecord) => void): () => void;
}

/**
 * The half that earns cells. `available` is answered by the host, not guessed
 * by the caller: a surface that cannot observe a position still shows the map
 * and whatever the journal already holds.
 */
export interface PresenceCapture {
  start(): Promise<void>;
  stop(): void;
  readonly available: boolean;
}

/**
 * What the renderer is allowed to know.
 *
 * Deliberately narrower than {@link PresenceStore}: the shader needs cell
 * membership and nothing else, and cell membership is already on screen. The
 * renderer cannot read a timestamp, a fix count, or an accuracy, which is what
 * keeps the tap the only route from a lit cell to journal text. Do not widen
 * this for convenience.
 */
export interface ShadeSource {
  litCells(): readonly CellIndex[];
  onCellLit(fn: (cell: CellIndex) => void): () => void;
}

export {
  createShadeSource,
  toShadeSource,
  type ManagedShadeSource,
} from "./shade-source";
export {
  formatDuration,
  formatInstant,
  toJournalRow,
  toJournalRows,
  type JournalRow,
} from "./journal-format";
