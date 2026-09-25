// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
} from "@nilx-one/presence-contract";
import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it, vi } from "vitest";

import {
  createFogField,
  readFogReveals,
  type FogRevealStorage,
} from "./fog-field";
import type { ShadeRuntime } from "./map-factory";

const HERE = { longitude: 30.5234, latitude: 50.4501 };
const HERE_CELL = latLngToCell(HERE.latitude, HERE.longitude, 9);

function memoryStorage(): FogRevealStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

function journal(lit: readonly CellIndex[]): {
  runtime: Promise<ShadeRuntime | null>;
  light(cell: CellIndex): void;
} {
  const cells = new Set(lit);
  const listeners = new Set<(cell: CellIndex) => void>();
  const source: ShadeSource = {
    litCells: () => [...cells],
    isLit: (cell) => cells.has(cell),
    onCellLit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    runtime: Promise.resolve({ store: {} as PresenceStore, source }),
    light(cell) {
      cells.add(cell);
      for (const listener of [...listeners]) listener(cell);
    },
  };
}

describe("fog field", () => {
  it("offers nothing and claims no fog until the journal answers", async () => {
    const { field, runtime } = createFogField(
      Promise.resolve(null),
      memoryStorage(),
    );
    await runtime;

    expect(field.isActive()).toBe(false);
    expect(field.isRevealed(HERE_CELL)).toBe(true);
    expect(field.frontier(HERE, 3)).toEqual([]);
  });

  it("offers the Bond's own cell and its neighbours when nothing is revealed", async () => {
    const { field, runtime } = createFogField(
      journal([]).runtime,
      memoryStorage(),
    );
    await runtime;

    const frontier = field.frontier(HERE, 3).map((cell) => cell.id);
    expect(frontier[0]).toBe(HERE_CELL);
    expect(new Set(frontier)).toEqual(new Set(gridDisk(HERE_CELL, 1)));
  });

  it("offers the edge of revealed ground within reach, nearest first", async () => {
    const lit = gridDisk(HERE_CELL, 1);
    const { field, runtime } = createFogField(
      journal(lit).runtime,
      memoryStorage(),
    );
    await runtime;

    const frontier = field.frontier(HERE, 3).map((cell) => cell.id);
    const ring2 = gridDisk(HERE_CELL, 2).filter((cell) => !lit.includes(cell));
    expect(new Set(frontier)).toEqual(new Set(ring2));
    for (const cell of frontier) expect(lit).not.toContain(cell);
  });

  it("reveals a cell on this device only, remembers it, and lights it for the shade", async () => {
    const storage = memoryStorage();
    const { field, runtime } = createFogField(journal([]).runtime, storage);
    const shade = await runtime;
    const lit = vi.fn();
    const changed = vi.fn();
    shade?.source.onCellLit(lit);
    field.subscribe(changed);

    field.reveal(HERE_CELL);
    field.reveal(HERE_CELL);

    expect(field.isRevealed(HERE_CELL)).toBe(true);
    expect(shade?.source.isLit(HERE_CELL)).toBe(true);
    expect(shade?.source.litCells()).toContain(HERE_CELL);
    expect(lit).toHaveBeenCalledExactlyOnceWith(HERE_CELL);
    expect(changed).toHaveBeenCalledOnce();
    expect(readFogReveals(storage)).toEqual([HERE_CELL]);

    const again = createFogField(journal([]).runtime, storage);
    await again.runtime;
    expect(again.field.isRevealed(HERE_CELL)).toBe(true);
  });

  it("refuses anything that is not a cell", async () => {
    const storage = memoryStorage();
    storage.setItem("nilx-one.fog.reveals.v1", '["nope", 7]');
    const { field, runtime } = createFogField(journal([]).runtime, storage);
    await runtime;

    field.reveal("not-a-cell");
    expect(readFogReveals(storage)).toEqual([]);
  });

  it("hears the journal lighting a cell as revealed ground", async () => {
    const source = journal([]);
    const { field, runtime } = createFogField(source.runtime, memoryStorage());
    await runtime;
    const changed = vi.fn();
    field.subscribe(changed);

    source.light(HERE_CELL);

    expect(changed).toHaveBeenCalledOnce();
    expect(field.isRevealed(HERE_CELL)).toBe(true);
  });

  it("describes a cell by its centre and outline", async () => {
    const { field } = createFogField(journal([]).runtime, memoryStorage());
    const cell = field.cellAt(HERE);

    expect(cell.id).toBe(HERE_CELL);
    expect(cell.boundary.length).toBeGreaterThanOrEqual(6);
    expect(Math.abs(cell.center.longitude - HERE.longitude)).toBeLessThan(0.01);
    expect(Math.abs(cell.center.latitude - HERE.latitude)).toBeLessThan(0.01);
  });
});
