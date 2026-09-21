// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
} from "@nilx-one/presence-contract";
import { gridDisk, latLngToCell } from "h3-js";
import type { CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { createShadeLayer } from "./shade-layer";

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
function fakeGl(): WebGL2RenderingContext & { drawArraysCallCount: number } {
  const OK = 1;
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

    drawArraysCallCount: 0,

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
    getUniformLocation: () => ({}) as WebGLUniformLocation,
    uniformMatrix4fv: () => undefined,
    uniform1i: () => undefined,
    uniform3fv: () => undefined,
    uniform1f: () => undefined,
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

  return gl as unknown as WebGL2RenderingContext & {
    drawArraysCallCount: number;
  };
}

function fakeMap(): MapLibreMap & {
  readonly triggerRepaint: ReturnType<typeof vi.fn>;
} {
  return {
    on: () => undefined,
    off: () => undefined,
    triggerRepaint: vi.fn(),
  } as unknown as MapLibreMap & {
    readonly triggerRepaint: ReturnType<typeof vi.fn>;
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
