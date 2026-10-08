// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
} from "@nilx-one/presence-contract";
import { gridDisk, latLngToCell } from "h3-js";
import type { CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DARK_FOG_PALETTE,
  DEFAULT_FOG_ZONE_FEATHER_M,
  LIGHT_FOG_PALETTE,
  MAX_FOG_ZONES,
  fogColor,
  type FogZone,
} from "./fog-palette";
import { FOG_FRAGMENT_SHADER } from "./fog-shader";
import {
  createShadeLayer,
  documentVisibility,
  type PageVisibility,
} from "./shade-layer";

const KYIV = { lng: 30.5234, lat: 50.4501 };

// prerender's interface signature carries a frame argument this layer's own
// implementation ignores (it only rasterizes into the offscreen lightmap);
// the fake stands in for whatever CustomRenderMethodInput a real frame would
// pass at that call site.
const IGNORED_PRERENDER_FRAME = {} as CustomRenderMethodInput;

/**
 * A minimal WebGL2 context. Every call this layer makes either succeeds
 * trivially or is recorded; nothing here renders anything, so the fake only
 * has to keep the layer's own bookkeeping (previous-state save/restore,
 * status checks) from throwing.
 */
type FakeGl = WebGL2RenderingContext & {
  drawArraysCallCount: number;
  generateMipmapCallCount: number;
  /** The last value each uniform was set to, by its name in the shader. */
  readonly uniformValues: Map<string, unknown>;
};

function fakeGl(): FakeGl {
  const OK = 1;
  const uniformValues = new Map<string, unknown>();
  const recordUniform =
    (arity: "scalar" | "vector" | "pair") =>
    (location: { readonly name: string } | null, ...values: unknown[]) => {
      if (location === null) return;
      uniformValues.set(
        location.name,
        arity === "vector"
          ? Array.from(values[0] as ArrayLike<number>)
          : arity === "pair"
            ? values
            : values[0],
      );
    };
  const parameters = new Map<number, unknown>([
    [0xffff_0001, new Int32Array([0, 0, 0, 0])], // VIEWPORT
    [0xffff_0002, new Float32Array([0, 0, 0, 0])], // COLOR_CLEAR_VALUE
  ]);

  const gl = {
    // Constants. Values only need to be distinct from each other.
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    DYNAMIC_DRAW: 6,
    STATIC_DRAW: 7,
    FLOAT: 8,
    TRIANGLE_FAN: 9,
    TRIANGLE_STRIP: 10,
    FRAMEBUFFER: 11,
    FRAMEBUFFER_BINDING: 12,
    VIEWPORT: 0xffff_0001,
    CURRENT_PROGRAM: 13,
    VERTEX_ARRAY_BINDING: 14,
    ARRAY_BUFFER_BINDING: 15,
    BLEND: 16,
    DEPTH_TEST: 17,
    TEXTURE_2D: 18,
    TEXTURE_BINDING_2D: 19,
    R8: 20,
    TEXTURE_MIN_FILTER: 21,
    TEXTURE_MAG_FILTER: 22,
    LINEAR: 23,
    TEXTURE_WRAP_S: 24,
    TEXTURE_WRAP_T: 25,
    CLAMP_TO_EDGE: 26,
    COLOR_ATTACHMENT0: 27,
    FRAMEBUFFER_COMPLETE: 28,
    COLOR_CLEAR_VALUE: 0xffff_0002,
    COLOR_BUFFER_BIT: 29,
    TEXTURE0: 30,
    ACTIVE_TEXTURE: 31,
    BLEND_SRC_RGB: 32,
    BLEND_DST_RGB: 33,
    BLEND_SRC_ALPHA: 34,
    BLEND_DST_ALPHA: 35,
    SRC_ALPHA: 36,
    ONE_MINUS_SRC_ALPHA: 37,
    ONE: 38,
    LINEAR_MIPMAP_LINEAR: 39,

    drawingBufferWidth: 780,
    drawingBufferHeight: 1520,
    drawArraysCallCount: 0,
    generateMipmapCallCount: 0,
    uniformValues,

    createShader: () => ({}) as WebGLShader,
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => OK,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    createProgram: () => ({}) as WebGLProgram,
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => OK,
    getProgramInfoLog: () => "",
    deleteProgram: () => undefined,
    createBuffer: () => ({}) as WebGLBuffer,
    deleteBuffer: () => undefined,
    createVertexArray: () => ({}) as WebGLVertexArrayObject,
    deleteVertexArray: () => undefined,
    bindVertexArray: () => undefined,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
    createTexture: () => ({}) as WebGLTexture,
    deleteTexture: () => undefined,
    bindTexture: () => undefined,
    texStorage2D: () => undefined,
    texParameteri: () => undefined,
    createFramebuffer: () => ({}) as WebGLFramebuffer,
    deleteFramebuffer: () => undefined,
    bindFramebuffer: () => undefined,
    framebufferTexture2D: () => undefined,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    clearColor: () => undefined,
    clear: () => undefined,
    generateMipmap: () => {
      gl.generateMipmapCallCount += 1;
    },
    getUniformLocation: (_program: WebGLProgram, name: string) => ({ name }),
    uniformMatrix4fv: recordUniform("pair"),
    uniform1i: recordUniform("scalar"),
    uniform1f: recordUniform("scalar"),
    uniform2f: recordUniform("pair"),
    uniform3fv: recordUniform("vector"),
    uniform4fv: recordUniform("vector"),
    blendFuncSeparate: () => undefined,
    activeTexture: () => undefined,
    viewport: () => undefined,
    useProgram: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    isEnabled: () => false,
    getParameter: (pname: number) => parameters.get(pname) ?? null,
    drawArrays: () => {
      gl.drawArraysCallCount += 1;
    },
  };

  return gl as unknown as FakeGl;
}

function fakeMap(): MapLibreMap & {
  readonly triggerRepaint: ReturnType<typeof vi.fn>;
} {
  return {
    on: () => undefined,
    off: () => undefined,
    triggerRepaint: vi.fn(),
    getZoom: () => 16,
    getCenter: () => KYIV,
    getPixelRatio: () => 2,
    getPitch: () => 32,
  } as unknown as MapLibreMap & {
    readonly triggerRepaint: ReturnType<typeof vi.fn>;
  };
}

/** A render frame: the layer reads only the projection it draws with. */
const FRAME = {
  defaultProjectionData: { mainMatrix: new Float64Array(16) },
} as unknown as CustomRenderMethodInput;

/** A page whose visibility the test flips, announcing it or not. */
function manualVisibility(initial = true): PageVisibility & {
  set(visible: boolean, options?: { readonly announce?: boolean }): void;
  readonly listeners: number;
} {
  let visible = initial;
  const listeners = new Set<(visible: boolean) => void>();
  return {
    isVisible: () => visible,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next, { announce = true } = {}) {
      visible = next;
      if (announce) for (const listener of [...listeners]) listener(next);
    },
    get listeners() {
      return listeners.size;
    },
  };
}

/** A hand-cranked clock and timer, so drift is observed rather than slept on. */
function manualClock(): {
  readonly now: () => number;
  readonly schedule: (callback: () => void, delayMs: number) => () => void;
  advance(ms: number): void;
  fire(): void;
  readonly pending: number;
  readonly delays: number[];
} {
  let time = 0;
  const callbacks = new Set<() => void>();
  const delays: number[] = [];
  return {
    now: () => time,
    schedule(callback, delayMs) {
      delays.push(delayMs);
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    advance(ms) {
      time += ms;
    },
    fire() {
      const due = [...callbacks];
      callbacks.clear();
      for (const callback of due) callback();
    },
    get pending() {
      return callbacks.size;
    },
    delays,
  };
}

function manyLitCellsAround(center: typeof KYIV, count: number): CellIndex[] {
  const origin = latLngToCell(center.lat, center.lng, 9);
  const disk = gridDisk(origin, 15);
  if (disk.length < count) {
    throw new Error("test fixture needs a larger grid disk for this count");
  }
  return disk.slice(0, count);
}

function litSource(
  lit: readonly CellIndex[],
): ShadeSource & { emit(cell: CellIndex): void } {
  const cells = new Set(lit);
  const listeners = new Set<(cell: CellIndex) => void>();
  return {
    litCells: () => [...cells],
    isLit: (cell) => cells.has(cell),
    onCellLit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(cell) {
      cells.add(cell);
      for (const listener of listeners) listener(cell);
    },
  };
}

const store: PresenceStore = {
  append: async () => undefined,
  listCells: async () => [],
  recordsForCell: async () => [],
  subscribe: () => () => undefined,
};

describe("shade layer cold-load batching", () => {
  it("bounds cells rasterized per flush and schedules another frame for the remainder", () => {
    const lit = manyLitCellsAround(KYIV, 12);
    const layer = createShadeLayer({
      source: litSource(lit),
      store,
      anchor: KYIV,
      cellsPerFlush: 5,
    });
    const gl = fakeGl();
    const map = fakeMap();

    layer.onAdd!(map, gl);
    expect(gl.drawArraysCallCount).toBe(0); // onAdd queues; it does not flush.

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(5);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(10);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(12);
    // The backlog just drained; nothing here asks for a frame nobody needs.
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(12);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(2);
  });

  it("drains a backlog at or below the batch size in one frame without an extra repaint", () => {
    const lit = manyLitCellsAround(KYIV, 4);
    const layer = createShadeLayer({
      source: litSource(lit),
      store,
      anchor: KYIV,
      cellsPerFlush: 512,
    });
    const gl = fakeGl();
    const map = fakeMap();

    layer.onAdd!(map, gl);
    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);

    expect(gl.drawArraysCallCount).toBe(4);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  it("keeps a live single-cell update a one-draw, one-repaint event", () => {
    const source = litSource([]);
    const layer = createShadeLayer({
      source,
      store,
      anchor: KYIV,
      cellsPerFlush: 5,
    });
    const gl = fakeGl();
    const map = fakeMap();

    layer.onAdd!(map, gl);
    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(0);
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    const [freshCell] = manyLitCellsAround(KYIV, 1);
    source.emit(freshCell as CellIndex);
    // onCellLit already asked for the frame that flushes it.
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.drawArraysCallCount).toBe(1);
    // A backlog of one, under the batch size, drains without asking again.
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
  });
});

describe("shade layer cellsPerFlush validation", () => {
  // A batch size that never shrinks `pending` would otherwise become an
  // infinite triggerRepaint loop inside flush() instead of a construction
  // error here — see requirePositiveInteger's own comment in shade-layer.ts.
  it.each([0, -1, -512])(
    "rejects a non-positive cellsPerFlush (%s) at construction",
    (cellsPerFlush) => {
      expect(() =>
        createShadeLayer({
          source: litSource([]),
          store,
          anchor: KYIV,
          cellsPerFlush,
        }),
      ).toThrow(/cellsPerFlush must be a positive integer/);
    },
  );

  it.each([5.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-integer cellsPerFlush (%s) at construction",
    (cellsPerFlush) => {
      expect(() =>
        createShadeLayer({
          source: litSource([]),
          store,
          anchor: KYIV,
          cellsPerFlush,
        }),
      ).toThrow(/cellsPerFlush must be a positive integer/);
    },
  );

  it("accepts the default when cellsPerFlush is not given", () => {
    expect(() =>
      createShadeLayer({ source: litSource([]), store, anchor: KYIV }),
    ).not.toThrow();
  });
});

describe("shade layer lightmap blur", () => {
  it("rebuilds the blurred levels after every batch it draws, and only then", () => {
    const source = litSource(manyLitCellsAround(KYIV, 3));
    const layer = createShadeLayer({ source, store, anchor: KYIV });
    const gl = fakeGl();

    layer.onAdd!(fakeMap(), gl);
    // The cleared lightmap is complete from its first frame.
    expect(gl.generateMipmapCallCount).toBe(1);

    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.generateMipmapCallCount).toBe(2);

    // Nothing new to draw, nothing to blur again.
    layer.prerender!(gl, IGNORED_PRERENDER_FRAME);
    expect(gl.generateMipmapCallCount).toBe(2);
  });
});

describe("shade layer palette and zones", () => {
  const amber: FogZone = {
    id: "amber",
    center: KYIV,
    radiusM: 400,
    palette: {
      shadow: fogColor("#a0634a"),
      light: fogColor("#ffe7cf"),
      glow: fogColor("#ff7a1a"),
      bloom: 0.2,
    },
  };

  function mounted(options: Partial<Parameters<typeof createShadeLayer>[0]>) {
    const layer = createShadeLayer({
      source: litSource([]),
      store,
      anchor: KYIV,
      motion: "still",
      ...options,
    });
    const gl = fakeGl();
    const map = fakeMap();
    layer.onAdd!(map, gl);
    return { layer, gl, map };
  }

  it("lights the fog with the light palette unless told otherwise", () => {
    const { layer, gl } = mounted({});
    layer.render!(gl, FRAME);

    const shadow = gl.uniformValues.get("u_shadow") as number[];
    expect(shadow).toHaveLength(3);
    shadow.forEach((channel, index) =>
      expect(channel).toBeCloseTo(LIGHT_FOG_PALETTE.shadow[index] ?? NaN, 5),
    );
    expect(gl.uniformValues.get("u_bloom")).toBe(0);
    expect(gl.uniformValues.get("u_zone_count")).toBe(0);
  });

  it("relights when the palette changes, and skips the frame when it did not", () => {
    const { layer, gl, map } = mounted({});

    layer.setPalette(LIGHT_FOG_PALETTE);
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    layer.setPalette(DARK_FOG_PALETTE);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_bloom")).toBeCloseTo(
      DARK_FOG_PALETTE.bloom,
      5,
    );
  });

  it("hands the shader each zone as metres from the anchor, with its palette", () => {
    const east = { lng: KYIV.lng + 0.01, lat: KYIV.lat };
    const { layer, gl, map } = mounted({ zones: [amber] });
    layer.render!(gl, FRAME);

    expect(gl.uniformValues.get("u_zone_count")).toBe(1);
    const [x, y, radius, feather] = gl.uniformValues.get(
      "u_zone_shape",
    ) as number[];
    // The region is centred on the anchor, so a zone there sits at its origin.
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(0, 3);
    expect(radius).toBe(400);
    expect(feather).toBe(DEFAULT_FOG_ZONE_FEATHER_M);
    const glow = gl.uniformValues.get("u_zone_glow") as number[];
    expect(glow.slice(0, 4).map((v) => Number(v.toFixed(4)))).toEqual(
      [...amber.palette.glow, 0.2].map((v) => Number(v.toFixed(4))),
    );
    expect(glow).toHaveLength(MAX_FOG_ZONES * 4);

    layer.setZones([{ ...amber, center: east, featherM: 90 }]);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render!(gl, FRAME);
    const [eastX, eastY, , eastFeather] = gl.uniformValues.get(
      "u_zone_shape",
    ) as number[];
    // 0.01° of longitude at Kyiv is about 710 m east (+x); y stays put.
    expect(eastX).toBeGreaterThan(690);
    expect(eastX).toBeLessThan(730);
    expect(eastY).toBeCloseTo(0, 3);
    expect(eastFeather).toBe(90);

    layer.setZones([]);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_zone_count")).toBe(0);
  });

  it("refuses more zones than the shader blends, and a zone that cannot be drawn", () => {
    const tooMany = Array.from({ length: MAX_FOG_ZONES + 1 }, (_, index) => ({
      ...amber,
      id: `zone-${index}`,
    }));
    expect(() => mounted({ zones: tooMany })).toThrow(/at most 8 fog zones/);

    const { layer } = mounted({ zones: [amber] });
    expect(() => layer.setZones([{ ...amber, radiusM: 0 }])).toThrow(
      /radiusM must be positive/,
    );
    expect(() =>
      layer.setPalette({ ...LIGHT_FOG_PALETTE, bloom: Number.NaN }),
    ).toThrow(/bloom must be in 0\.\.1/);
  });
});

describe("shade layer drift", () => {
  it("asks for the next frame after each one it draws, one request at a time", () => {
    const clock = manualClock();
    const layer = createShadeLayer({
      source: litSource([]),
      store,
      anchor: KYIV,
      now: clock.now,
      schedule: clock.schedule,
    });
    const gl = fakeGl();
    const map = fakeMap();
    expect(layer.motion).toBe("drift");

    layer.onAdd!(map, gl);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_time")).toBe(0);
    expect(clock.pending).toBe(1);
    expect(clock.delays).toEqual([1_000 / 24]);

    // Another frame while one is already asked for asks for nothing more.
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(1);
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    clock.advance(1_500);
    clock.fire();
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_time")).toBeCloseTo(1.5, 5);
    expect(clock.pending).toBe(1);

    layer.onRemove!(map, gl);
    expect(clock.pending).toBe(0);
  });

  it("holds still mist at one moment and never asks for a frame of its own", () => {
    const clock = manualClock();
    const layer = createShadeLayer({
      source: litSource([]),
      store,
      anchor: KYIV,
      motion: "still",
      now: clock.now,
      schedule: clock.schedule,
    });
    const gl = fakeGl();
    const map = fakeMap();

    layer.onAdd!(map, gl);
    clock.advance(10_000);
    layer.render!(gl, FRAME);

    expect(gl.uniformValues.get("u_time")).toBe(0);
    expect(clock.pending).toBe(0);
    expect(map.triggerRepaint).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a frame interval (%s) that is not a positive number",
    (frameIntervalMs) => {
      expect(() =>
        createShadeLayer({
          source: litSource([]),
          store,
          anchor: KYIV,
          frameIntervalMs,
        }),
      ).toThrow(/frameIntervalMs must be a positive number/);
    },
  );
});

describe("shade layer drift while the page is hidden", () => {
  function drifting(visibility: ReturnType<typeof manualVisibility>) {
    const clock = manualClock();
    const layer = createShadeLayer({
      source: litSource([]),
      store,
      anchor: KYIV,
      now: clock.now,
      schedule: clock.schedule,
      visibility,
    });
    const gl = fakeGl();
    const map = fakeMap();
    layer.onAdd!(map, gl);
    return { layer, gl, map, clock };
  }

  it("cancels the frame it asked for when the page hides, and asks for none while hidden", () => {
    const visibility = manualVisibility();
    const { layer, gl, map, clock } = drifting(visibility);
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(1);

    visibility.set(false);
    expect(clock.pending).toBe(0);

    // A frame MapLibre draws for its own reasons while hidden asks for nothing.
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(0);
    clock.fire();
    expect(map.triggerRepaint).not.toHaveBeenCalled();

    // Shown again: one frame to draw the mist, and that frame asks for the next.
    visibility.set(true);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(1);
  });

  it("never wakes the map from a timer that fires after the page hid unannounced", () => {
    const visibility = manualVisibility();
    const { layer, gl, map, clock } = drifting(visibility);
    layer.render!(gl, FRAME);

    visibility.set(false, { announce: false });
    clock.fire();
    expect(map.triggerRepaint).not.toHaveBeenCalled();
    // The timer learned the page is hidden, so the chain stays stopped.
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(0);

    visibility.set(true);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
  });

  it("resumes the mist where it paused, not where the wall clock is", () => {
    const visibility = manualVisibility();
    const { layer, gl, clock } = drifting(visibility);

    clock.advance(1_000);
    visibility.set(false);
    clock.advance(60_000);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_time")).toBeCloseTo(1, 5);

    visibility.set(true);
    clock.advance(500);
    layer.render!(gl, FRAME);
    expect(gl.uniformValues.get("u_time")).toBeCloseTo(1.5, 5);
  });

  it("waits for a page that was already hidden when the layer was added", () => {
    const visibility = manualVisibility(false);
    const { layer, gl, map, clock } = drifting(visibility);

    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(0);

    visibility.set(true);
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    layer.render!(gl, FRAME);
    expect(clock.pending).toBe(1);
  });

  it("stops listening when removed, and still mist never listens at all", () => {
    const visibility = manualVisibility();
    const { layer, gl, map } = drifting(visibility);
    expect(visibility.listeners).toBe(1);
    layer.onRemove!(map, gl);
    expect(visibility.listeners).toBe(0);

    const stillVisibility = manualVisibility();
    const still = createShadeLayer({
      source: litSource([]),
      store,
      anchor: KYIV,
      motion: "still",
      visibility: stillVisibility,
    });
    still.onAdd!(fakeMap(), fakeGl());
    expect(stillVisibility.listeners).toBe(0);
  });
});

describe("document visibility", () => {
  let state: DocumentVisibilityState = "visible";

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
  });

  function stubVisibility(): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
  }

  it("follows the document's visibilitychange until unsubscribed", () => {
    stubVisibility();
    const visibility = documentVisibility();
    const heard: boolean[] = [];
    const stop = visibility.subscribe((visible) => heard.push(visible));

    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(visibility.isVisible()).toBe(false);
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    stop();
    state = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    expect(heard).toEqual([false, true]);
  });
});

// Shader contract: perspective haze may use screen height, but the mist's
// directional illumination must belong to the ground across camera changes.
describe("fog world lighting", () => {
  it("anchors shafts and relief to ground coordinates", () => {
    expect(FOG_FRAGMENT_SHADER).toContain("dot(m, vec2(0.94, 0.34))");
    expect(FOG_FRAGMENT_SHADER).not.toContain("gl_FragCoord.xy");
    expect(FOG_FRAGMENT_SHADER).not.toContain(
      "vec2(dFdx(cloud), dFdy(cloud)) *",
    );
  });
});
