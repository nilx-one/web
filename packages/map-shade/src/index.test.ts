// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex, ShadeSource } from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";
import type { Map as MapLibreMap } from "maplibre-gl";
import { describe, expect, it, vi } from "vitest";

import { createGlDouble } from "./gl-double";
import { SHADE_LAYER_ID, createShadeLayer } from "./index";

const ANCHOR = { longitude: 30.5234, latitude: 50.4501 };
const HOME_CELL = latLngToCell(ANCHOR.latitude, ANCHOR.longitude, 9);
const ELSEWHERE = { lng: 30.6, lat: 50.5 };

function fakeSource(initial: readonly CellIndex[] = []): ShadeSource & {
  light(cell: CellIndex): void;
} {
  const cells = [...initial];
  const listeners = new Set<(cell: CellIndex) => void>();
  return {
    litCells: () => [...cells],
    onCellLit(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    light(cell) {
      cells.push(cell);
      for (const listener of [...listeners]) listener(cell);
    },
  };
}

function fakeMap(): MapLibreMap & {
  click(lngLat: { lng: number; lat: number }): void;
  repaints: () => number;
} {
  const handlers = new Set<(event: unknown) => void>();
  let repaints = 0;
  return {
    on(_type: string, handler: (event: unknown) => void) {
      handlers.add(handler);
    },
    off(_type: string, handler: (event: unknown) => void) {
      handlers.delete(handler);
    },
    triggerRepaint() {
      repaints += 1;
    },
    click(lngLat: { lng: number; lat: number }) {
      for (const handler of [...handlers]) handler({ lngLat });
    },
    repaints: () => repaints,
  } as unknown as MapLibreMap & {
    click(lngLat: { lng: number; lat: number }): void;
    repaints: () => number;
  };
}

function frame(matrix = new Float32Array(16).fill(1)) {
  return {
    defaultProjectionData: { mainMatrix: matrix },
  } as unknown as Parameters<ReturnType<typeof createShadeLayer>["render"]>[1];
}

describe("the shade layer's shape", () => {
  it("is a flat custom layer under a stable id", () => {
    const layer = createShadeLayer({ source: fakeSource(), anchor: ANCHOR });

    expect(layer.id).toBe(SHADE_LAYER_ID);
    expect(layer.type).toBe("custom");
    expect(layer.renderingMode).toBe("2d");
  });

  it("allocates the lightmap as a single-channel mask", () => {
    const { gl, textureImages } = createGlDouble();
    const layer = createShadeLayer({ source: fakeSource(), anchor: ANCHOR });

    layer.onAdd?.(fakeMap(), gl);

    expect(textureImages).toHaveLength(1);
    expect(textureImages[0]?.internalFormat).toBe(gl.R8);
    expect(textureImages[0]?.format).toBe(gl.RED);
  });
});

describe("rasterising cells", () => {
  it("replays the journal's cells once the layer is added", () => {
    const other = latLngToCell(50.462, 30.5234, 9);
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL, other]),
      anchor: ANCHOR,
    });

    layer.onAdd?.(fakeMap(), gl);
    layer.prerender?.(gl, frame());

    expect(draws.filter((draw) => draw.mode === gl.TRIANGLE_FAN)).toHaveLength(
      2,
    );
  });

  it("draws nothing per frame once cells are stamped", () => {
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(fakeMap(), gl);
    layer.prerender?.(gl, frame());
    draws.length = 0;

    layer.prerender?.(gl, frame());
    layer.prerender?.(gl, frame());

    expect(draws).toEqual([]);
  });

  it("stamps a newly earned cell on the next frame, and only once", () => {
    const source = fakeSource();
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({ source, anchor: ANCHOR });
    layer.onAdd?.(fakeMap(), gl);

    source.light(HOME_CELL);
    layer.prerender?.(gl, frame());
    layer.prerender?.(gl, frame());

    expect(draws.filter((draw) => draw.mode === gl.TRIANGLE_FAN)).toHaveLength(
      1,
    );
  });

  it("ignores a cell it has already stamped", () => {
    const source = fakeSource();
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({ source, anchor: ANCHOR });
    layer.onAdd?.(fakeMap(), gl);

    source.light(HOME_CELL);
    source.light(HOME_CELL);
    layer.prerender?.(gl, frame());

    expect(draws.filter((draw) => draw.mode === gl.TRIANGLE_FAN)).toHaveLength(
      1,
    );
  });

  it("asks for a repaint when a cell is earned", () => {
    const source = fakeSource();
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({ source, anchor: ANCHOR });
    layer.onAdd?.(map, gl);
    const before = map.repaints();

    source.light(HOME_CELL);

    expect(map.repaints()).toBeGreaterThan(before);
  });

  it("stamps into the lightmap's own framebuffer and viewport", () => {
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
      lightmapSize: 512,
    });
    layer.onAdd?.(fakeMap(), gl);

    layer.prerender?.(gl, frame());

    const stamp = draws.find((draw) => draw.mode === gl.TRIANGLE_FAN);
    expect(stamp?.framebuffer).not.toBeNull();
    expect(stamp?.viewport).toEqual([0, 0, 512, 512]);
  });

  it("hands back the framebuffer and viewport it borrowed", () => {
    const { gl, boundFramebuffer, viewport } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(fakeMap(), gl);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, 1024, 768);

    layer.prerender?.(gl, frame());

    expect(boundFramebuffer()).toBeNull();
    expect(viewport()).toEqual([0, 0, 1024, 768]);
  });
});

describe("the render pass", () => {
  it("draws one quad with the matrix MapLibre supplied", () => {
    const { gl, draws, uniforms } = createGlDouble();
    const matrix = new Float32Array(16).fill(0.5);
    const layer = createShadeLayer({ source: fakeSource(), anchor: ANCHOR });
    layer.onAdd?.(fakeMap(), gl);
    draws.length = 0;

    layer.render(gl, frame(matrix));

    const quads = draws.filter((draw) => draw.mode === gl.TRIANGLES);
    expect(quads).toHaveLength(1);
    expect(quads[0]?.count).toBe(6);
    expect(uniforms.get("u_matrix")).toBe(matrix);
  });

  it("passes the shade colour and alpha through", () => {
    const { gl, uniforms } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource(),
      anchor: ANCHOR,
      shadeColor: [0.1, 0.2, 0.3],
      shadeAlpha: 0.5,
    });
    layer.onAdd?.(fakeMap(), gl);

    layer.render(gl, frame());

    expect(uniforms.get("u_shadeColor")).toEqual([0.1, 0.2, 0.3]);
    expect(uniforms.get("u_shadeAlpha")).toBe(0.5);
  });

  it("does nothing before it has been added", () => {
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({ source: fakeSource(), anchor: ANCHOR });

    expect(() => layer.render(gl, frame())).not.toThrow();
    expect(draws).toEqual([]);
  });
});

describe("tapping the ground", () => {
  it("reports a tap on a lit cell", () => {
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(map, gl);
    const activated = vi.fn();
    layer.subscribeCellActivation(activated);

    map.click({ lng: ANCHOR.longitude, lat: ANCHOR.latitude });

    expect(activated).toHaveBeenCalledWith(HOME_CELL);
  });

  it("stays silent on a cell that was never visited", () => {
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(map, gl);
    const activated = vi.fn();
    layer.subscribeCellActivation(activated);

    map.click(ELSEWHERE);

    expect(activated).not.toHaveBeenCalled();
  });

  it("reports a cell that lit after the map was already up", () => {
    const source = fakeSource();
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({ source, anchor: ANCHOR });
    layer.onAdd?.(map, gl);
    const activated = vi.fn();
    layer.subscribeCellActivation(activated);

    source.light(HOME_CELL);
    map.click({ lng: ANCHOR.longitude, lat: ANCHOR.latitude });

    expect(activated).toHaveBeenCalledWith(HOME_CELL);
  });

  it("stops reporting once unsubscribed", () => {
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(map, gl);
    const activated = vi.fn();
    layer.subscribeCellActivation(activated)();

    map.click({ lng: ANCHOR.longitude, lat: ANCHOR.latitude });

    expect(activated).not.toHaveBeenCalled();
  });

  it("hands the tap a cell and never journal text", () => {
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(map, gl);
    const seen: unknown[] = [];
    layer.subscribeCellActivation((cell) => seen.push(cell));

    map.click({ lng: ANCHOR.longitude, lat: ANCHOR.latitude });

    expect(seen).toEqual([HOME_CELL]);
    expect(typeof seen[0]).toBe("string");
  });
});

describe("teardown", () => {
  it("releases every GPU object it made", () => {
    const { gl, deleted } = createGlDouble();
    const map = fakeMap();
    const layer = createShadeLayer({ source: fakeSource(), anchor: ANCHOR });
    layer.onAdd?.(map, gl);

    layer.onRemove?.(map, gl);

    expect(deleted.sort()).toEqual([
      "buffer",
      "buffer",
      "framebuffer",
      "program",
      "program",
      "texture",
    ]);
  });

  it("stops listening to the journal when removed", () => {
    const source = fakeSource();
    const map = fakeMap();
    const { gl, draws } = createGlDouble();
    const layer = createShadeLayer({ source, anchor: ANCHOR });
    layer.onAdd?.(map, gl);
    layer.onRemove?.(map, gl);
    draws.length = 0;

    source.light(HOME_CELL);

    expect(() => layer.prerender?.(gl, frame())).not.toThrow();
    expect(draws).toEqual([]);
  });

  it("stops reporting taps when removed", () => {
    const map = fakeMap();
    const { gl } = createGlDouble();
    const layer = createShadeLayer({
      source: fakeSource([HOME_CELL]),
      anchor: ANCHOR,
    });
    layer.onAdd?.(map, gl);
    const activated = vi.fn();
    layer.subscribeCellActivation(activated);

    layer.onRemove?.(map, gl);
    map.click({ lng: ANCHOR.longitude, lat: ANCHOR.latitude });

    expect(activated).not.toHaveBeenCalled();
  });
});
