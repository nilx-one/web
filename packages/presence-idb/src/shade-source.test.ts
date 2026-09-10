// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  VisitRecord,
} from "@nilx-one/presence-contract";
import { describe, expect, it, vi } from "vitest";

import { createShadeSource } from "./index";

const CELL_A = "891fb46622fffff";
const CELL_B = "891fb46620bffff";

function visit(cell: CellIndex): VisitRecord {
  return {
    cell,
    enteredAt: 1_000_000,
    leftAt: null,
    source: "self",
    fixCount: 2,
    bestAccuracyM: 9,
  };
}

function fakeStore(cells: readonly CellIndex[]): {
  readonly store: PresenceStore;
  readonly recordsForCell: ReturnType<typeof vi.fn>;
  emit(record: VisitRecord): void;
} {
  const listeners = new Set<(record: VisitRecord) => void>();
  const recordsForCell = vi.fn(async () => []);
  return {
    recordsForCell,
    emit(record) {
      for (const listener of [...listeners]) listener(record);
    },
    store: {
      append: async () => undefined,
      listCells: async () => [...cells],
      recordsForCell,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

describe("shade source", () => {
  it("projects already-stored cells without any capture", async () => {
    // A host that never captures still renders the ground the journal already
    // holds: the projection is replayed from storage, not from a live tracker.
    const { store, recordsForCell } = fakeStore([CELL_A, CELL_B]);
    const source = await createShadeSource(store);

    expect([...source.litCells()].sort()).toEqual([CELL_B, CELL_A].sort());
    expect(source.isLit(CELL_A)).toBe(true);
    expect(source.isLit("891fb466227ffff")).toBe(false);
    expect(recordsForCell).not.toHaveBeenCalled();

    source.close();
  });

  it("announces a cell the first time it is lit and never again", async () => {
    const { store, emit } = fakeStore([]);
    const source = await createShadeSource(store);
    const onCellLit = vi.fn();
    source.onCellLit(onCellLit);

    emit(visit(CELL_A));
    emit(visit(CELL_A));

    expect(onCellLit.mock.calls).toEqual([[CELL_A]]);
    expect(source.isLit(CELL_A)).toBe(true);

    source.close();
  });

  it("stops observing the journal once closed", async () => {
    const { store, emit } = fakeStore([]);
    const source = await createShadeSource(store);
    const onCellLit = vi.fn();
    source.onCellLit(onCellLit);

    source.close();
    emit(visit(CELL_B));

    expect(onCellLit).not.toHaveBeenCalled();
    expect(source.isLit(CELL_B)).toBe(false);
  });
});
