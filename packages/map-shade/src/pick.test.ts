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
import { describe, expect, it, vi } from "vitest";

import { cellAtLngLat, createTapHandler, formatRecords } from "./pick";

const KYIV = { lng: 30.5234, lat: 50.4501 };

function visit(overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    cell: cellAtLngLat(KYIV),
    enteredAt: 1_000_000,
    leftAt: null,
    source: "self",
    fixCount: 4,
    bestAccuracyM: 12.4,
    ...overrides,
  };
}

function litSource(lit: readonly CellIndex[]): ShadeSource {
  const cells = new Set(lit);
  return {
    litCells: () => [...cells],
    isLit: (cell) => cells.has(cell),
    onCellLit: () => () => undefined,
  };
}

function journal(records: readonly VisitRecord[]): {
  readonly store: PresenceStore;
  readonly recordsForCell: ReturnType<typeof vi.fn>;
} {
  const recordsForCell = vi.fn(async (cell: CellIndex) =>
    records.filter((record) => record.cell === cell),
  );
  return {
    recordsForCell,
    store: {
      append: async () => undefined,
      listCells: async () => [],
      recordsForCell,
      subscribe: () => () => undefined,
    },
  };
}

describe("cellAtLngLat", () => {
  it("indexes at the presence resolution by default", () => {
    expect(cellAtLngLat(KYIV)).toBe(
      latLngToCell(KYIV.lat, KYIV.lng, PRESENCE_RESOLUTION),
    );
  });

  it("honours an explicit resolution override", () => {
    expect(cellAtLngLat(KYIV, 7)).toBe(latLngToCell(KYIV.lat, KYIV.lng, 7));
  });
});

describe("cell tap", () => {
  it("returns the raw journal for a lit cell", async () => {
    const cell = cellAtLngLat(KYIV);
    const record = visit({ cell });
    const { store } = journal([record]);
    const tap = createTapHandler({ source: litSource([cell]), store });

    expect(await tap(KYIV)).toEqual({ cell, records: [record] });
  });

  it("never reads the journal for ground that is not lit", async () => {
    // Dark cells are not tappable, and the absence of a tap target is the only
    // thing that keeps the journal unreadable for ground nobody has stood on.
    const { store, recordsForCell } = journal([visit()]);
    const tap = createTapHandler({ source: litSource([]), store });

    expect(await tap(KYIV)).toBeNull();
    expect(recordsForCell).not.toHaveBeenCalled();
  });
});

describe("formatRecords", () => {
  it("renders a closed dwell as plain columns", () => {
    expect(
      formatRecords([
        visit({ enteredAt: 1_000_000, leftAt: 1_600_000, bestAccuracyM: 12.4 }),
      ]),
    ).toEqual([
      "1970-01-01T00:16:40.000Z  1970-01-01T00:26:40.000Z  10m  4 fixes  ±12m  self",
    ]);
  });

  it("marks a dwell that is still open", () => {
    const [row] = formatRecords([visit({ leftAt: null })]);

    expect(row).toContain("open");
    expect(row).toContain("—");
  });
});
