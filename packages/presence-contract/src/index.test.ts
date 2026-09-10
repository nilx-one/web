// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  PRESENCE_RESOLUTION,
  createShadeSource,
  formatDuration,
  toShadeSource,
  toJournalRows,
  type CellIndex,
  type PresenceStore,
  type VisitRecord,
} from "./index";

function visit(overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    cell: "891f1d48a83ffff",
    enteredAt: 1_700_000_000_000,
    leftAt: null,
    source: "self",
    fixCount: 4,
    bestAccuracyM: 12.4,
    ...overrides,
  };
}

function fakeStore(cells: readonly CellIndex[] = []): PresenceStore & {
  emit(record: VisitRecord): void;
  listCalls: number;
} {
  const listeners = new Set<(record: VisitRecord) => void>();
  const state = {
    listCalls: 0,
    async append(): Promise<void> {},
    async listCells(): Promise<CellIndex[]> {
      state.listCalls += 1;
      return [...cells];
    },
    async recordsForCell(): Promise<readonly VisitRecord[]> {
      return [];
    },
    subscribe(onAppend: (record: VisitRecord) => void): () => void {
      listeners.add(onAppend);
      return () => listeners.delete(onAppend);
    },
    emit(record: VisitRecord): void {
      for (const listener of [...listeners]) listener(record);
    },
  };
  return state;
}

describe("presence contract", () => {
  it("records presence at a resolution that means a place, not an address", () => {
    expect(PRESENCE_RESOLUTION).toBe(9);
  });
});

describe("createShadeSource", () => {
  it("replays cells already in the journal", async () => {
    const source = createShadeSource(fakeStore(["a", "b"]));

    await source.start();

    expect([...source.litCells()].sort()).toEqual(["a", "b"]);
  });

  it("announces seeded cells so a listener attached first is not left behind", async () => {
    const source = createShadeSource(fakeStore(["a", "b"]));
    const lit: CellIndex[] = [];
    source.onCellLit((cell) => lit.push(cell));

    await source.start();

    expect(lit.sort()).toEqual(["a", "b"]);
  });

  it("announces appends that land after start", async () => {
    const store = fakeStore([]);
    const source = createShadeSource(store);
    const lit: CellIndex[] = [];
    await source.start();
    source.onCellLit((cell) => lit.push(cell));

    store.emit(visit({ cell: "c" }));

    expect(lit).toEqual(["c"]);
    expect(source.litCells()).toEqual(["c"]);
  });

  it("does not drop an append that lands while the journal is being listed", async () => {
    const store = fakeStore(["a"]);
    const source = createShadeSource(store);
    const started = source.start();
    store.emit(visit({ cell: "mid" }));

    await started;

    expect([...source.litCells()].sort()).toEqual(["a", "mid"]);
  });

  it("announces each cell once however many visits it collects", async () => {
    const store = fakeStore(["a"]);
    const source = createShadeSource(store);
    const listener = vi.fn();
    source.onCellLit(listener);
    await source.start();

    store.emit(visit({ cell: "a" }));
    store.emit(visit({ cell: "a", leftAt: 1 }));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops announcing once stopped", async () => {
    const store = fakeStore([]);
    const source = createShadeSource(store);
    await source.start();
    const listener = vi.fn();
    source.onCellLit(listener);

    source.stop();
    store.emit(visit({ cell: "z" }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("hands the renderer no way to read journal contents", async () => {
    const managed = createShadeSource(fakeStore(["a"]));
    await managed.start();

    const surface: ShadeSurface = toShadeSource(managed);

    expect(Object.keys(surface).sort()).toEqual(["litCells", "onCellLit"]);
    expect(surface.litCells()).toEqual(["a"]);
  });

  it("keeps the narrowed source live rather than snapshotting it", async () => {
    const store = fakeStore([]);
    const managed = createShadeSource(store);
    const surface = toShadeSource(managed);
    const lit: CellIndex[] = [];
    surface.onCellLit((cell) => lit.push(cell));
    await managed.start();

    store.emit(visit({ cell: "later" }));

    expect(lit).toEqual(["later"]);
    expect(surface.litCells()).toEqual(["later"]);
  });
});

// The renderer only ever holds these two methods. If a future change widens
// ShadeSource, this stops compiling before it reaches a shader.
type ShadeSurface = {
  litCells(): readonly CellIndex[];
  onCellLit(fn: (cell: CellIndex) => void): () => void;
};

describe("journal formatting", () => {
  it("shows an unfinished visit as open rather than guessing an end", () => {
    const [row] = toJournalRows([visit()]);

    expect(row?.left).toBe("—");
    expect(row?.dwell).toBe("open");
  });

  it("reports a closed visit's dwell", () => {
    const [row] = toJournalRows([
      visit({ enteredAt: 0, leftAt: 3 * 60_000 + 7_000 }),
    ]);

    expect(row?.dwell).toBe("3m07s");
  });

  it("orders records by entry", () => {
    const rows = toJournalRows([
      visit({ enteredAt: 2_000 }),
      visit({ enteredAt: 1_000 }),
    ]);

    expect(rows.map((row) => row.entered)).toEqual([
      "1970-01-01T00:00:01.000Z",
      "1970-01-01T00:00:02.000Z",
    ]);
  });

  it("formats durations across the scale", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(59_999)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m00s");
    expect(formatDuration(3_600_000)).toBe("1h00m");
    expect(formatDuration(-1)).toBe("—");
  });
});
