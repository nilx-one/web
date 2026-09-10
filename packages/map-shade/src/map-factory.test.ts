// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
} from "@nilx-one/presence-contract";
import type * as MapLibreModule from "maplibre-gl";
import type { MapOptions } from "maplibre-gl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createShadeMapFactory, type ShadeRuntime } from "./map-factory";

// Declared through vi.hoisted so the mock factory below, which vitest lifts to
// the top of the module, can still reference it.
const { FakeMap } = vi.hoisted(() => {
  class FakeMap {
    static instances: FakeMap[] = [];

    readonly listeners = new globalThis.Map<string, Set<() => void>>();
    readonly layers = new globalThis.Map<string, { readonly id: string }>();
    readonly addLayerCalls: {
      readonly id: string;
      readonly before: string | undefined;
    }[] = [];
    styleLoaded = true;
    styleLayers: { id: string; type: string }[] = [
      { id: "background", type: "background" },
      { id: "roads", type: "line" },
      { id: "place-labels", type: "symbol" },
    ];

    constructor(readonly options: unknown) {
      FakeMap.instances.push(this);
    }

    on(event: string, listener: () => void): this {
      const bucket = this.listeners.get(event) ?? new Set<() => void>();
      bucket.add(listener);
      this.listeners.set(event, bucket);
      return this;
    }

    off(): this {
      return this;
    }

    emit(event: string): void {
      for (const listener of [...(this.listeners.get(event) ?? [])]) listener();
    }

    isStyleLoaded(): boolean {
      return this.styleLoaded;
    }

    getLayer(id: string): { readonly id: string } | undefined {
      return this.layers.get(id);
    }

    getStyle(): { layers: { id: string; type: string }[] } {
      return { layers: this.styleLayers };
    }

    addLayer(layer: { readonly id: string }, before?: string): void {
      this.addLayerCalls.push({ id: layer.id, before });
      this.layers.set(layer.id, layer);
    }
  }

  return { FakeMap };
});

vi.mock("maplibre-gl", async (importOriginal) => ({
  ...(await importOriginal<typeof MapLibreModule>()),
  Map: FakeMap,
}));

type FakeMapInstance = InstanceType<typeof FakeMap>;

function fakeRuntime(lit: readonly CellIndex[]): ShadeRuntime {
  const cells = new Set(lit);
  const source: ShadeSource = {
    litCells: () => [...cells],
    isLit: (cell) => cells.has(cell),
    onCellLit: () => () => undefined,
  };
  const store: PresenceStore = {
    append: async () => undefined,
    listCells: async () => [...cells],
    recordsForCell: async () => [],
    subscribe: () => () => undefined,
  };
  return { source, store };
}

const MAP_OPTIONS = { container: "map" } as unknown as MapOptions;
const ANCHOR = { lng: 30.5234, lat: 50.4501 };
const SHADE_LAYER_ID = "nilx-one-presence-shade";

/** The factory wires the layer from a promise, so let that microtask land. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Runs `work` while collecting rejections nothing else handled. Wiring happens
 * inside a detached promise chain, so a failure there never reaches the caller
 * of the factory: it surfaces only here.
 */
async function unhandledDuring(work: () => Promise<void>): Promise<unknown[]> {
  const rejections: unknown[] = [];
  const collect = (reason: unknown): void => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", collect);
  try {
    await work();
    // Node reports an unhandled rejection only after the microtask queue has
    // drained, so give it one macrotask turn before deciding it stayed clean.
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off("unhandledRejection", collect);
  }
  return rejections;
}

function build(runtime: ShadeRuntime | null): FakeMapInstance {
  const createMap = createShadeMapFactory({
    runtime: Promise.resolve(runtime),
    anchor: ANCHOR,
  });
  return createMap(MAP_OPTIONS) as unknown as FakeMapInstance;
}

beforeEach(() => {
  FakeMap.instances = [];
});

describe("shade map factory", () => {
  it("degrades to the plain map when no journal runtime is available", async () => {
    // A host without storage or capture must still get the map it had before
    // presence existed: no shade layer, no failure, nothing to recover from.
    let map: FakeMapInstance | undefined;
    const rejections = await unhandledDuring(async () => {
      map = build(null);
      await settle();
      map.emit("load");
      map.emit("styledata");
    });

    expect(rejections).toEqual([]);
    expect(map).toBe(FakeMap.instances[0]);
    expect(map?.addLayerCalls).toEqual([]);
    expect(map?.layers.size).toBe(0);
  });

  it("renders whatever the journal already holds, below the symbol layers", async () => {
    const map = build(fakeRuntime(["891fb46622fffff"]));
    await settle();

    expect(map.addLayerCalls).toEqual([
      { id: SHADE_LAYER_ID, before: "place-labels" },
    ]);
  });

  it("adds the layer once across repeated style events", async () => {
    const map = build(fakeRuntime([]));
    await settle();
    map.emit("styledata");
    map.emit("load");
    map.emit("styledata");

    expect(map.addLayerCalls).toHaveLength(1);
  });

  it("waits for the style before adding the layer", async () => {
    const map = build(fakeRuntime([]));
    map.styleLoaded = false;
    await settle();
    expect(map.addLayerCalls).toEqual([]);

    map.styleLoaded = true;
    map.emit("styledata");
    expect(map.addLayerCalls).toHaveLength(1);
  });

  it("does not touch a map that was removed before the journal resolved", async () => {
    const map = build(fakeRuntime([]));
    map.emit("remove");
    await settle();
    map.emit("styledata");

    expect(map.addLayerCalls).toEqual([]);
  });
});
