// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";
import { latLngToCell, gridDisk } from "h3-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWebGlFog,
  createWebGpuFog,
  type FogBackend,
} from "./fog-backend";
import {
  createShadeLayer,
  type PageVisibility,
  type ShadeLayer,
} from "./shade-layer";

vi.mock("./fog-backend", () => ({
  createWebGpuFog: vi.fn(),
  createWebGlFog: vi.fn(),
}));
const anchor = { lng: 30.5234, lat: 50.4501 };
const cell = latLngToCell(anchor.lat, anchor.lng, 9);
const store = {} as PresenceStore;
let layers: ShadeLayer[];
let gpu: FogBackend;
let gl: FogBackend;
let context: CanvasRenderingContext2D;
let filled: string[];
const fills = () => filled;
// LIGHT_FOG_PALETTE's shadow, the colour of fog that has drawn no frame yet.
const MIST = "rgb(144 175 195)";
function backend(kind: FogBackend["kind"]): FogBackend {
  const canvas = document.createElement("canvas");
  return {
    kind,
    canvas,
    render: vi.fn(async (_mask, _parameters, _changed, present) => {
      present(canvas);
    }),
    dispose: vi.fn(),
  };
}
function source(initial = [cell]) {
  let cells = new Set(initial);
  const added = new Set<(cell: string) => void>();
  const removed = new Set<(cell: string) => void>();
  const resets = new Set<() => void>();
  return {
    litCells: () => [...cells],
    isLit: (cell: string) => cells.has(cell),
    onCellLit(fn) {
      added.add(fn);
      return () => {
        added.delete(fn);
      };
    },
    onCellUnlit(fn) {
      removed.add(fn);
      return () => {
        removed.delete(fn);
      };
    },
    onReset(fn) {
      resets.add(fn);
      return () => {
        resets.delete(fn);
      };
    },
    add(cell: string) {
      cells.add(cell);
      for (const fn of added) fn(cell);
    },
    remove(cell: string) {
      cells.delete(cell);
      for (const fn of removed) fn(cell);
    },
    reset(next: string[]) {
      cells = new Set(next);
      for (const fn of resets) fn();
    },
    get listeners() {
      return added.size + removed.size + resets.size;
    },
  } satisfies ShadeSource & {
    add(cell: string): void;
    remove(cell: string): void;
    reset(next: string[]): void;
    readonly listeners: number;
  };
}
function mount(options: Partial<Parameters<typeof createShadeLayer>[0]> = {}) {
  const onFrame = vi.fn();
  const onError = vi.fn();
  const layer = createShadeLayer({
    source: source(),
    store,
    anchor,
    onFrame,
    onError,
    ...options,
  });
  layers.push(layer);
  return { layer, onFrame, onError };
}
beforeEach(() => {
  vi.useFakeTimers();
  layers = [];
  filled = [];
  context = {
    fillRect: vi.fn(function (this: CanvasRenderingContext2D) {
      filled.push(String(this.fillStyle));
    }),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as GPUCanvasContext,
  );
  gpu = backend("webgpu");
  gl = backend("webgl2");
  vi.mocked(createWebGpuFog).mockReset().mockResolvedValue(gpu);
  vi.mocked(createWebGlFog).mockReset().mockReturnValue(gl);
});
afterEach(() => {
  for (const layer of layers) layer.dispose();
  vi.useRealTimers();
});

describe("geographic fog surface", () => {
  it("prefers WebGPU and does not animate a still surface", async () => {
    const { onFrame } = mount();
    await vi.runAllTimersAsync();
    expect(createWebGpuFog).toHaveBeenCalledOnce();
    expect(createWebGlFog).not.toHaveBeenCalled();
    expect(gpu.render).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("falls back on adapter or pipeline initialization failure", async () => {
    vi.mocked(createWebGpuFog).mockRejectedValue(new Error("adapter refused"));
    const { onFrame, onError } = mount();
    await vi.runAllTimersAsync();
    expect(gl.render).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
  it("times out a hung GPU request and disposes a late device", async () => {
    let resolve!: (backend: FogBackend) => void;
    vi.mocked(createWebGpuFog).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    await vi.advanceTimersByTimeAsync(2_010);
    expect(gl.render).toHaveBeenCalledOnce();
    resolve(gpu);
    await Promise.resolve();
    expect(gpu.dispose).toHaveBeenCalledOnce();
  });
  it("keeps the canvas and mask when a WebGPU device is lost", async () => {
    const { layer } = mount();
    const canvas = layer.canvas;
    await vi.runAllTimersAsync();
    const mask = vi.mocked(gpu.render).mock.calls[0]![0];
    vi.mocked(createWebGpuFog).mock.calls[0]![1]();
    await vi.runAllTimersAsync();
    expect(layer.canvas).toBe(canvas);
    expect(gpu.dispose).toHaveBeenCalled();
    expect(gl.render).toHaveBeenCalledWith(
      mask,
      expect.any(Float32Array),
      true,
      expect.any(Function),
    );
  });
  it("keeps opacity and mask fixed while only the material clock advances", async () => {
    mount({ motion: "drift" });
    await vi.advanceTimersByTimeAsync(2_100);
    const calls = vi.mocked(gpu.render).mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[0]![0]).toBe(calls[1]![0]);
    expect(calls[0]![1][2]).toBe(calls[1]![1][2]);
    expect(calls[1]![1][1]).toBeGreaterThan(calls[0]![1][1]!);
    expect(calls[1]![2]).toBe(false);
  });
  it("does no hidden-page work and does not count hidden time as drift", async () => {
    let notify!: (visible: boolean) => void;
    const visibility: PageVisibility = {
      isVisible: () => true,
      subscribe: (fn) => {
        notify = fn;
        return vi.fn();
      },
    };
    mount({ motion: "drift", visibility });
    await vi.advanceTimersByTimeAsync(1_010);
    const before = vi.mocked(gpu.render).mock.calls.at(-1)![1][1]!;
    notify(false);
    const count = vi.mocked(gpu.render).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gpu.render).toHaveBeenCalledTimes(count);
    notify(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.mocked(gpu.render).mock.calls.at(-1)![1][1]!).toBeLessThan(
      before + 0.02,
    );
  });
  it("starts as solid mist before any frame is drawn", async () => {
    let resolve!: (backend: FogBackend) => void;
    vi.mocked(createWebGpuFog).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { onFrame } = mount();
    expect(fills()).toContain(MIST);
    expect(context.drawImage).not.toHaveBeenCalled();
    resolve(gpu);
    await vi.runAllTimersAsync();
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
  });
  it("drifts at a frame a second, not as fast as the map can draw", async () => {
    mount({ motion: "drift" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(vi.mocked(gpu.render).mock.calls.length).toBeLessThanOrEqual(11);
  });
  it("falls back to mist when a frame fails after presenting", async () => {
    vi.mocked(gpu.render).mockImplementationOnce(
      async (_mask, _parameters, _changed, present) => {
        present(gpu.canvas);
        throw new Error("device lost");
      },
    );
    const { onFrame } = mount();
    await vi.runAllTimersAsync();
    // Initial mist, then mist again over the broken frame.
    expect(fills().filter((style) => style === MIST)).toHaveLength(2);
    expect(gl.render).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
  });
  it("adds newly revealed cells even with reduced motion", async () => {
    const cells = source([]);
    mount({ source: cells });
    await vi.runAllTimersAsync();
    cells.add(cell);
    await vi.runAllTimersAsync();
    expect(context.fill).toHaveBeenCalledOnce();
    expect(vi.mocked(gpu.render).mock.calls.at(-1)![2]).toBe(true);
  });
  it("closes one cell without veiling or rebuilding the surface", async () => {
    const neighbour = gridDisk(cell, 1).find((next) => next !== cell)!;
    const cells = source([cell, neighbour]);
    const { onFrame } = mount({ source: cells });
    await vi.runAllTimersAsync();
    filled.length = 0;
    vi.mocked(context.fill).mockClear();
    cells.remove(cell);
    await vi.runAllTimersAsync();
    // Black over the closed cell, then its still-open neighbour redrawn.
    expect(fills()).not.toContain(MIST);
    expect(context.fill).toHaveBeenCalledTimes(2);
    expect(vi.mocked(gpu.render).mock.calls.at(-1)![2]).toBe(true);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });
  it("does not publish a half-loaded cold journal", async () => {
    const cells = gridDisk(cell, 14);
    expect(cells.length).toBeGreaterThan(512);
    const { onFrame } = mount({ source: source(cells) });
    await vi.runAllTimersAsync();
    expect(context.fill).toHaveBeenCalledTimes(cells.length);
    expect(gpu.render).toHaveBeenCalledOnce();
    expect(onFrame).toHaveBeenCalledOnce();
  });
  it("rebuilds replacement membership and discards an in-flight old mask", async () => {
    const cells = source();
    let done!: () => void;
    vi.mocked(gpu.render).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const { onFrame } = mount({ source: cells });
    await vi.advanceTimersByTimeAsync(1);
    cells.reset([]);
    done();
    await vi.runAllTimersAsync();
    expect(context.drawImage).toHaveBeenCalledOnce();
    expect(gpu.render).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(2); // opaque reset + new complete frame
  });
  it("reports both backends failing instead of claiming a rendered frame", async () => {
    vi.mocked(createWebGpuFog).mockRejectedValue(new Error("no GPU"));
    vi.mocked(createWebGlFog).mockImplementation(() => {
      throw new Error("no GL");
    });
    const { onFrame, onError } = mount();
    await vi.runAllTimersAsync();
    expect(onFrame).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
  });
  it("releases listeners, timers and a device resolved after disposal", async () => {
    const cells = source();
    let resolve!: (backend: FogBackend) => void;
    vi.mocked(createWebGpuFog).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { layer, onFrame } = mount({ source: cells });
    await vi.advanceTimersByTimeAsync(1);
    layer.dispose();
    resolve(gpu);
    await vi.runAllTimersAsync();
    expect(cells.listeners).toBe(0);
    expect(gpu.dispose).toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
  });
});
