// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapFogField,
  MapPointSelection,
} from "@nilx-one/map-contract";
import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
  VisitRecord,
} from "@nilx-one/presence-contract";
import { cellToBoundary, cellToLatLng, gridDisk, isValidCell } from "h3-js";

import type { ShadeRuntime } from "./map-factory";
import { cellAtLngLat } from "./pick";

const STORAGE_PREFIX = "nilx-one.fog.reveals.v1.";

/**
 * The least closed-visit time a cell needs before it can be home: one
 * passing dwell is not where someone lives. A starting value.
 */
export const HOME_MIN_DWELL_MS = 60 * 60 * 1000;

/** Closed-visit time in one cell's folded records; an open visit counts none. */
export function dwellMs(records: readonly VisitRecord[]): number {
  let total = 0;
  for (const record of records) {
    if (record.leftAt !== null && record.leftAt > record.enteredAt) {
      total += record.leftAt - record.enteredAt;
    }
  }
  return total;
}

/**
 * The cell dwelt in longest, at least `HOME_MIN_DWELL_MS`, ties to the
 * smallest id, so the same journal always gives the same home.
 */
export function homeCellOf(
  dwelt: ReadonlyMap<CellIndex, number>,
): CellIndex | undefined {
  let best: CellIndex | undefined;
  let bestMs = HOME_MIN_DWELL_MS - 1;
  for (const [cell, ms] of dwelt) {
    if (ms > bestMs || (ms === bestMs && best !== undefined && cell < best)) {
      best = cell;
      bestMs = ms;
    }
  }
  return best;
}

/** Enough for a city's worth of reveals, small enough to stay a note. */
export const FOG_REVEAL_LIMIT = 5_000;

export interface FogRevealStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): FogRevealStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function storageKeyFor(owner: string): string {
  return STORAGE_PREFIX + owner;
}

/**
 * What this device remembers revealing for one Bond. Never throws, never
 * guesses. `owner` is required: a reveal is this Bond's own, and a device
 * shared by more than one Bond must never answer one from another's key.
 */
export function readFogReveals(
  owner: string,
  storage: FogRevealStorage | undefined = defaultStorage(),
): CellIndex[] {
  try {
    const raw = storage?.getItem(storageKeyFor(owner));
    if (raw === null || raw === undefined) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (cell): cell is CellIndex =>
        typeof cell === "string" && isValidCell(cell),
    );
  } catch {
    return [];
  }
}

function writeFogReveals(
  owner: string,
  cells: readonly CellIndex[],
  storage: FogRevealStorage | undefined,
): void {
  try {
    storage?.setItem(
      storageKeyFor(owner),
      JSON.stringify(cells.slice(-FOG_REVEAL_LIMIT)),
    );
  } catch {
    // Remembering is best-effort: a full or blocked store forgets, it never breaks the world.
  }
}

/**
 * The lit cells the shade layer draws: what the journal lit, and what this
 * device revealed. The journal's own membership is untouched — a reveal is
 * never written into it — so the raw presence path still answers only for
 * visits this device actually made.
 */
function unionShadeSource(
  journal: ShadeSource,
  reveals: Set<CellIndex>,
  subscribeReveals: (listener: (cell: CellIndex) => void) => () => void,
): ShadeSource {
  return {
    litCells: () => [...new Set([...journal.litCells(), ...reveals])],
    isLit: (cell) => reveals.has(cell) || journal.isLit(cell),
    onCellLit(listener) {
      const fromJournal = journal.onCellLit((cell) => {
        if (!reveals.has(cell)) listener(cell);
      });
      const fromReveals = subscribeReveals((cell) => {
        if (!journal.isLit(cell)) listener(cell);
      });
      return () => {
        fromJournal();
        fromReveals();
      };
    },
  };
}

function describeCell(cell: CellIndex): MapFogCell {
  const [latitude, longitude] = cellToLatLng(cell);
  return {
    id: cell,
    center: { longitude, latitude },
    boundary: cellToBoundary(cell, true).map(
      ([lng, lat]) => [lng, lat] as const,
    ),
  };
}

export interface FogFieldComposition {
  /** The fog the application reasons about. */
  readonly field: MapFogField;
  /**
   * The runtime the shade layer and `createGroundRevealed` should draw from:
   * the journal's, with this device's reveals lit alongside it.
   */
  readonly runtime: Promise<ShadeRuntime | null>;
}

/**
 * Composes the fog a host draws from its presence journal and the reveals
 * this device made. Reveals live in local storage under
 * `nilx-one.fog.reveals.v1.<owner>`, one Bond's alone: they are presentation
 * state, not presence evidence, and nothing sends them anywhere today. They
 * are transport-eligible, which is not synced state and not service state.
 * Nothing is read from
 * or written to storage until `bindOwner`
 * names whose reveals these are — a device this Bond only just signed into,
 * or one another Bond used before it, must never answer from a stale or
 * absent owner's key.
 */
export function createFogField(
  journal: Promise<ShadeRuntime | null>,
  storage: FogRevealStorage | undefined = defaultStorage(),
): FogFieldComposition {
  const reveals = new Set<CellIndex>();
  let owner: string | undefined;
  const cellListeners = new Set<(cell: CellIndex) => void>();
  const listeners = new Set<() => void>();
  let source: ShadeSource | undefined;

  const subscribeReveals = (
    listener: (cell: CellIndex) => void,
  ): (() => void) => {
    cellListeners.add(listener);
    return () => cellListeners.delete(listener);
  };

  // Home is read from the journal here, inside the presence boundary: the
  // durations stay in this closure, and the field hands out one point.
  const dwelt = new Map<CellIndex, number>();
  let homeCell: CellIndex | undefined;
  const measure = async (store: PresenceStore, cell: CellIndex) => {
    try {
      dwelt.set(cell, dwellMs(await store.recordsForCell(cell)));
      homeCell = homeCellOf(dwelt);
    } catch {
      // An unreadable cell is no home; it never breaks the fog.
    }
  };

  const runtime = journal.then(
    (resolved) => {
      if (resolved === null) return null;
      void (async () => {
        for (const cell of resolved.source.litCells()) {
          await measure(resolved.store, cell);
        }
      })();
      resolved.store.subscribe((record) => {
        if (record.leftAt !== null) void measure(resolved.store, record.cell);
      });
      source = unionShadeSource(resolved.source, reveals, subscribeReveals);
      // A cell the journal lights is revealed ground too, and whoever is
      // working out the frontier needs to hear about it.
      resolved.source.onCellLit(() => {
        for (const listener of [...listeners]) listener();
      });
      for (const listener of [...listeners]) listener();
      return { store: resolved.store, source };
    },
    () => null,
  );

  const isRevealed = (cell: CellIndex): boolean =>
    source === undefined || source.isLit(cell);

  const field: MapFogField = {
    isActive: () => source !== undefined,

    cellAt(point: MapPointSelection) {
      return describeCell(
        cellAtLngLat({ lng: point.longitude, lat: point.latitude }),
      );
    },

    isRevealed,

    frontier(point, rings) {
      if (source === undefined) return [];
      const origin = cellAtLngLat({
        lng: point.longitude,
        lat: point.latitude,
      });
      const reach = Math.max(1, Math.floor(rings));
      // The Bond is never in the fog: the cell it stands on is ground it
      // already has, whether or not its fog has lifted yet. It is never
      // offered, and it is open ground its neighbours touch.
      const open = (cell: CellIndex): boolean =>
        cell === origin || isRevealed(cell);
      const found: CellIndex[] = [];
      // gridDisk answers ring by ring from the origin outwards, which is
      // already nearest first.
      for (const cell of gridDisk(origin, reach)) {
        if (open(cell)) continue;
        if (gridDisk(cell, 1).some((next) => next !== cell && open(next))) {
          found.push(cell);
        }
      }
      return found.map(describeCell);
    },

    reveal(cellId) {
      if (!isValidCell(cellId) || reveals.has(cellId)) return;
      reveals.add(cellId);
      // Unbound, this reveal stays in memory only: there is no owner yet to
      // write it under, and writing it under none would mean writing it
      // under everyone.
      if (owner !== undefined) writeFogReveals(owner, [...reveals], storage);
      for (const listener of [...cellListeners]) listener(cellId);
      for (const listener of [...listeners]) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    home() {
      return homeCell === undefined ? undefined : describeCell(homeCell).center;
    },

    bindOwner(nextOwner) {
      if (owner === nextOwner) return;
      // A different Bond signed in on this device: its own reveals replace
      // whatever the previous owner's were, never merge with them.
      owner = nextOwner;
      reveals.clear();
      for (const cell of readFogReveals(nextOwner, storage)) reveals.add(cell);
      for (const listener of [...listeners]) listener();
    },
  };

  return { field, runtime };
}
