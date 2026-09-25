// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapFogCell,
  MapFogField,
  MapPointSelection,
} from "@nilx-one/map-contract";
import type { CellIndex, ShadeSource } from "@nilx-one/presence-contract";
import { cellToBoundary, cellToLatLng, gridDisk, isValidCell } from "h3-js";

import type { ShadeRuntime } from "./map-factory";
import { cellAtLngLat } from "./pick";

const STORAGE_PREFIX = "nilx-one.fog.reveals.v1.";

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
 * state, not presence evidence, and they are never synced, exported, or sent
 * anywhere. Nothing is read from or written to storage until `bindOwner`
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

  const runtime = journal.then(
    (resolved) => {
      if (resolved === null) return null;
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
      const near = new Set(gridDisk(origin, 1));
      const found: CellIndex[] = [];
      // gridDisk answers ring by ring from the origin outwards, which is
      // already nearest first.
      for (const cell of gridDisk(origin, reach)) {
        if (isRevealed(cell)) continue;
        if (
          near.has(cell) ||
          gridDisk(cell, 1).some((next) => next !== cell && isRevealed(next))
        ) {
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
