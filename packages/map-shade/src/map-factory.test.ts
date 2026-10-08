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

import { DARK_FOG_PALETTE, LIGHT_FOG_PALETTE } from "./fog-palette";
import {
  createGroundRevealed,
  createShadeMapFactory,
  type ShadeRuntime,
} from "./map-factory";
import { cellAtLngLat } from "./pick";
import {
  createShadeLayer,
  type ShadeLayer,
  type ShadeLayerOptions,
} from "./shade-layer";

vi.mock("./shade-layer", () => ({
  createShadeLayer: vi.fn((options: ShadeLayerOptions) => ({
    id: "nilx-one-presence-shade",
    canvas: document.createElement("canvas"),
    coordinates: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
    motion: options.motion,
    setPalette: vi.fn(),
    setZones: vi.fn(),
    dispose: vi.fn(),
  })),
}));

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
    readonly sources = new globalThis.Map<
      string,
      { canvas: HTMLCanvasElement; play: () => void; pause: () => void }
    >();
    getSource(id: string) {
      return this.sources.get(id);
    }
    addSource(id: string, value: { canvas: HTMLCanvasElement }) {
      this.sources.set(id, { ...value, play: vi.fn(), pause: vi.fn() });
    }
    once(event: string, listener: () => void) {
      return this.on(event, listener);
    }
    fire() {}
    terrain: { tileManager: { releaseAllRTT: () => void } } | null = null;
    styleLoaded = true;
    styleMetadata: Record<string, unknown> | undefined = undefined;
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

    getStyle(): {
      layers: { id: string; type: string }[];
      metadata?: Record<string, unknown>;
    } {
      return {
        layers: this.styleLayers,
        ...(this.styleMetadata === undefined
          ? {}
          : { metadata: this.styleMetadata }),
      };
    }

    triggerRepaint(): void {}

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

function build(
  runtime: ShadeRuntime | null,
  options: Partial<Parameters<typeof createShadeMapFactory>[0]> = {},
): FakeMapInstance {
  const createMap = createShadeMapFactory({
    runtime: Promise.resolve(runtime),
    anchor: ANCHOR,
    prefersReducedMotion: () => false,
    ...options,
  });
  return createMap(MAP_OPTIONS) as unknown as FakeMapInstance;
}

function shadeLayerOf(map: FakeMapInstance): ShadeLayer {
  const canvas = map.sources.get("nilx-one-presence-shade-canvas")?.canvas;
  const layer = vi
    .mocked(createShadeLayer)
    .mock.results.map((result) => result.value as ShadeLayer)
    .find((surface) => surface.canvas === canvas);
  expect(layer, "the shade layer is on the map").toBeDefined();
  return layer as unknown as ShadeLayer;
}

beforeEach(() => {
  FakeMap.instances = [];
  vi.mocked(createShadeLayer).mockClear();
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

  it("redrapes terrain with every new fog frame", async () => {
    // Terrain caches its draped ground per tile and never notices a canvas
    // upload; without a release the ground keeps the fog of its first draw.
    const map = build(fakeRuntime([]));
    const releaseAllRTT = vi.fn();
    map.terrain = { tileManager: { releaseAllRTT } };
    await settle();
    const { onFrame } = vi.mocked(createShadeLayer).mock.calls[0]![0];
    releaseAllRTT.mockClear();

    onFrame();
    onFrame();

    expect(releaseAllRTT).toHaveBeenCalledTimes(2);
    expect(
      map.sources.get("nilx-one-presence-shade-canvas")?.play,
    ).toHaveBeenCalled();
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

  it("lights the fog for the appearance the style declares, and relights on a swap", async () => {
    const map = build(fakeRuntime([]));
    await settle();
    const layer = shadeLayerOf(map);
    const setPalette = vi.spyOn(layer, "setPalette");

    map.styleMetadata = { "nilx-one:appearance": "dark" };
    map.emit("styledata");
    expect(setPalette).toHaveBeenLastCalledWith(DARK_FOG_PALETTE);

    map.styleMetadata = { "nilx-one:appearance": "light" };
    map.emit("styledata");
    expect(setPalette).toHaveBeenLastCalledWith(LIGHT_FOG_PALETTE);
    // A swap relights the layer already on the map; it never adds a second.
    expect(map.addLayerCalls).toHaveLength(1);
  });

  it("lets a host supply its own palettes per appearance", async () => {
    const dusk = { ...DARK_FOG_PALETTE, bloom: 0.2 };
    const map = build(fakeRuntime([]), {
      fogPalettes: { light: LIGHT_FOG_PALETTE, dark: dusk },
    });
    await settle();
    const setPalette = vi.spyOn(shadeLayerOf(map), "setPalette");

    map.styleMetadata = { "nilx-one:appearance": "dark" };
    map.emit("styledata");
    expect(setPalette).toHaveBeenLastCalledWith(dusk);
  });

  it("holds the mist still for a person who asked not to be moved", async () => {
    const drifting = build(fakeRuntime([]));
    const still = build(fakeRuntime([]), { prefersReducedMotion: () => true });
    await settle();

    expect(shadeLayerOf(drifting).motion).toBe("drift");
    expect(shadeLayerOf(still).motion).toBe("still");
  });

  it("tells the composing host about fog it could not draw, before any map exists", () => {
    // Deferred into the journal's promise, this would surface as an unhandled
    // rejection and a map quietly without fog.
    expect(() =>
      createShadeMapFactory({
        runtime: Promise.resolve(fakeRuntime([])),
        anchor: ANCHOR,
        fogZones: [
          {
            id: "broken",
            center: ANCHOR,
            radiusM: -5,
            palette: LIGHT_FOG_PALETTE,
          },
        ],
      }),
    ).toThrow(/radiusM must be positive/);
    expect(() =>
      createShadeMapFactory({
        runtime: Promise.resolve(fakeRuntime([])),
        anchor: ANCHOR,
        fogPalettes: {
          light: LIGHT_FOG_PALETTE,
          dark: { ...DARK_FOG_PALETTE, light: [2, 0, 0] },
        },
      }),
    ).toThrow(/fogPalettes\.dark\.light must be three channels/);
    expect(FakeMap.instances).toEqual([]);
  });

  it("does not touch a map that was removed before the journal resolved", async () => {
    const map = build(fakeRuntime([]));
    map.emit("remove");
    await settle();
    map.emit("styledata");

    expect(map.addLayerCalls).toEqual([]);
  });
});

describe("ground this device has revealed", () => {
  const here = { longitude: 30.5234, latitude: 50.4501 };
  const elsewhere = { longitude: 30.6, latitude: 50.5 };

  it("answers from the same lit cells the shade draws", async () => {
    const lit = cellAtLngLat({ lng: here.longitude, lat: here.latitude });
    const source: ShadeSource = {
      litCells: () => [lit],
      isLit: (cell: CellIndex) => cell === lit,
      onCellLit: () => () => undefined,
    };
    const runtime = Promise.resolve({
      source,
      store: {} as PresenceStore,
    } satisfies ShadeRuntime);
    const revealed = createGroundRevealed(runtime);
    await runtime;

    expect(revealed(here)).toBe(true);
    expect(revealed(elsewhere)).toBe(false);
  });

  it("claims no fog while the journal loads, or when it never does", async () => {
    let resolve: (value: ShadeRuntime | null) => void = () => undefined;
    const pending = createGroundRevealed(
      new Promise<ShadeRuntime | null>((settle) => {
        resolve = settle;
      }),
    );
    expect(pending(elsewhere)).toBe(true);
    resolve(null);
    await Promise.resolve();
    expect(pending(elsewhere)).toBe(true);
  });
});
