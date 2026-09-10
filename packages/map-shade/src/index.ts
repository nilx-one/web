// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CellIndex, ShadeSource } from "@nilx-one/presence-contract";
import { latLngToCell } from "h3-js";
import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";

import {
  LIGHTMAP_SIZE,
  REGION_M,
  cellFanVertices,
  createShadeRegion,
  regionQuadVertices,
  type LngLat,
  type ShadeRegion,
} from "./region";
import {
  SHADE_FRAGMENT_SOURCE,
  SHADE_VERTEX_SOURCE,
  STAMP_FRAGMENT_SOURCE,
  STAMP_VERTEX_SOURCE,
} from "./shaders";

export {
  LIGHTMAP_SIZE,
  REGION_M,
  cellFanVertices,
  containsLngLat,
  createShadeRegion,
  mercatorFromLngLat,
  mercatorUnitsPerMetre,
  regionQuadVertices,
  uvFromLngLat,
  uvFromMercator,
  type LngLat,
  type MercatorPoint,
  type ShadeRegion,
} from "./region";

export const SHADE_LAYER_ID = "nilx-one-presence-shade";

/** Near-black, and mostly opaque. Tunable, but not by much: the point is dark. */
export const DEFAULT_SHADE_COLOR: readonly [number, number, number] = [
  0.02, 0.02, 0.04,
];
export const DEFAULT_SHADE_ALPHA = 0.82;

export interface ShadeLayerOptions {
  /**
   * The narrow half of the journal. This layer is given cell membership and
   * nothing else — no timestamps, no fix counts, no route back to the store —
   * so the tap stays the only way from a lit cell to journal text.
   */
  readonly source: ShadeSource;
  /** The centre of the lightmap's fixed window on the world. */
  readonly anchor: LngLat;
  readonly regionMetres?: number;
  readonly lightmapSize?: number;
  readonly shadeColor?: readonly [number, number, number];
  readonly shadeAlpha?: number;
  readonly resolution?: number;
}

export interface ShadeCustomLayer extends CustomLayerInterface {
  /**
   * Taps on a cell that is lit. A dark cell reports nothing: there is no
   * journal behind it, so there is nothing to show.
   */
  subscribeCellActivation(listener: (cell: CellIndex) => void): () => void;
  /** The region this layer draws, for a caller that wants to check coverage. */
  readonly region: ShadeRegion;
  dispose(): void;
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) {
    throw new Error("shade layer could not create a shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (program === null) {
    throw new Error("shade layer could not create a program");
  }
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
}

/**
 * The ground shader.
 *
 * Darkens everywhere the person has never physically been. The lightmap is one
 * fixed texture in mercator space rather than geometry per cell: cells
 * accumulate without bound as somebody walks, and an H3 index has no texel of
 * its own, so per-cell geometry would grow with the journal. A cell is
 * rasterised once, on the frame after it is earned, and after that the CPU
 * does nothing per frame at all.
 */
export function createShadeLayer(options: ShadeLayerOptions): ShadeCustomLayer {
  const region = createShadeRegion(
    options.anchor,
    options.regionMetres ?? REGION_M,
  );
  const lightmapSize = options.lightmapSize ?? LIGHTMAP_SIZE;
  const shadeColor = options.shadeColor ?? DEFAULT_SHADE_COLOR;
  const shadeAlpha = options.shadeAlpha ?? DEFAULT_SHADE_ALPHA;

  const activationListeners = new Set<(cell: CellIndex) => void>();
  const stamped = new Set<CellIndex>();
  let pending: CellIndex[] = [];

  let map: MapLibreMap | undefined;
  let stampProgram: WebGLProgram | undefined;
  let shadeProgram: WebGLProgram | undefined;
  let lightmap: WebGLTexture | undefined;
  let framebuffer: WebGLFramebuffer | undefined;
  let quadBuffer: WebGLBuffer | undefined;
  let stampBuffer: WebGLBuffer | undefined;
  let unsubscribeSource: (() => void) | undefined;
  let onMapClick:
    ((event: { lngLat: { lng: number; lat: number } }) => void) | undefined;

  function queue(cell: CellIndex): void {
    if (stamped.has(cell)) {
      return;
    }
    stamped.add(cell);
    pending.push(cell);
    map?.triggerRepaint();
  }

  function stampPending(gl: WebGL2RenderingContext): void {
    // The common frame: nothing was earned, so nothing happens.
    if (
      pending.length === 0 ||
      stampProgram === undefined ||
      framebuffer === undefined ||
      stampBuffer === undefined
    ) {
      return;
    }

    const previousFramebuffer = gl.getParameter(
      gl.FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const blendWasEnabled = gl.isEnabled(gl.BLEND);
    const depthWasEnabled = gl.isEnabled(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, lightmapSize, lightmapSize);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(stampProgram);

    const clipLocation = gl.getAttribLocation(stampProgram, "a_clip");
    gl.bindBuffer(gl.ARRAY_BUFFER, stampBuffer);
    gl.enableVertexAttribArray(clipLocation);
    gl.vertexAttribPointer(clipLocation, 2, gl.FLOAT, false, 0, 0);

    for (const cell of pending) {
      const fan = cellFanVertices(region, cell);
      gl.bufferData(gl.ARRAY_BUFFER, fan, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, fan.length / 2);
    }
    pending = [];

    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.viewport(
      previousViewport[0] ?? 0,
      previousViewport[1] ?? 0,
      previousViewport[2] ?? 0,
      previousViewport[3] ?? 0,
    );
    if (blendWasEnabled) gl.enable(gl.BLEND);
    if (depthWasEnabled) gl.enable(gl.DEPTH_TEST);
  }

  return {
    id: SHADE_LAYER_ID,
    type: "custom",
    // Flat ground cover. It shares no depth with the buildings above it, and
    // is added under the symbol layers so labels stay readable through it.
    renderingMode: "2d",
    region,

    onAdd(mountedMap, gl) {
      map = mountedMap;
      stampProgram = link(gl, STAMP_VERTEX_SOURCE, STAMP_FRAGMENT_SOURCE);
      shadeProgram = link(gl, SHADE_VERTEX_SOURCE, SHADE_FRAGMENT_SOURCE);

      lightmap = gl.createTexture() ?? undefined;
      gl.bindTexture(gl.TEXTURE_2D, lightmap ?? null);
      // R8: one byte per texel, and a binary mask needs no more than that.
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        lightmapSize,
        lightmapSize,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      framebuffer = gl.createFramebuffer() ?? undefined;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer ?? null);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        lightmap ?? null,
        0,
      );
      // Everywhere starts dark: an empty journal means an unlit world.
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      quadBuffer = gl.createBuffer() ?? undefined;
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer ?? null);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        regionQuadVertices(region),
        gl.STATIC_DRAW,
      );
      stampBuffer = gl.createBuffer() ?? undefined;

      // Replayed once, then kept live. Doing both means the layer is correct
      // whether the journal loaded before or after the map did.
      for (const cell of options.source.litCells()) {
        queue(cell);
      }
      unsubscribeSource = options.source.onCellLit(queue);

      onMapClick = (event) => {
        const cell = latLngToCell(
          event.lngLat.lat,
          event.lngLat.lng,
          options.resolution ?? 9,
        );
        // A dark cell is not tappable. Nothing was recorded there, so there is
        // no journal to open and nothing honest to say about it.
        if (!stamped.has(cell)) {
          return;
        }
        for (const listener of [...activationListeners]) {
          listener(cell);
        }
      };
      mountedMap.on("click", onMapClick);
    },

    prerender(gl) {
      // Rasterising into a texture belongs here, not in render: this is the
      // hook MapLibre gives a layer that draws to its own framebuffer.
      stampPending(gl);
    },

    render(gl: WebGL2RenderingContext, frame: CustomRenderMethodInput) {
      if (
        shadeProgram === undefined ||
        quadBuffer === undefined ||
        lightmap === undefined
      ) {
        return;
      }

      gl.useProgram(shadeProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);

      const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
      const positionLocation = gl.getAttribLocation(shadeProgram, "a_pos");
      const uvLocation = gl.getAttribLocation(shadeProgram, "a_uv");
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(uvLocation);
      gl.vertexAttribPointer(
        uvLocation,
        2,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );

      gl.uniformMatrix4fv(
        gl.getUniformLocation(shadeProgram, "u_matrix"),
        false,
        // Mercator in, clip space out. A projection matrix is all a layer that
        // only claims mercator needs.
        frame.defaultProjectionData.mainMatrix,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.uniform1i(gl.getUniformLocation(shadeProgram, "u_lightmap"), 0);
      gl.uniform3f(
        gl.getUniformLocation(shadeProgram, "u_shadeColor"),
        shadeColor[0],
        shadeColor[1],
        shadeColor[2],
      );
      gl.uniform1f(
        gl.getUniformLocation(shadeProgram, "u_shadeAlpha"),
        shadeAlpha,
      );

      gl.enable(gl.BLEND);
      // Premultiplied, matching what the fragment shader emits.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    onRemove(_removedMap, gl) {
      if (onMapClick !== undefined) {
        map?.off("click", onMapClick);
        onMapClick = undefined;
      }
      unsubscribeSource?.();
      unsubscribeSource = undefined;
      if (stampProgram !== undefined) gl.deleteProgram(stampProgram);
      if (shadeProgram !== undefined) gl.deleteProgram(shadeProgram);
      if (lightmap !== undefined) gl.deleteTexture(lightmap);
      if (framebuffer !== undefined) gl.deleteFramebuffer(framebuffer);
      if (quadBuffer !== undefined) gl.deleteBuffer(quadBuffer);
      if (stampBuffer !== undefined) gl.deleteBuffer(stampBuffer);
      stampProgram = undefined;
      shadeProgram = undefined;
      lightmap = undefined;
      framebuffer = undefined;
      quadBuffer = undefined;
      stampBuffer = undefined;
      map = undefined;
    },

    subscribeCellActivation(listener) {
      activationListeners.add(listener);
      return () => {
        activationListeners.delete(listener);
      };
    },

    dispose() {
      unsubscribeSource?.();
      unsubscribeSource = undefined;
      activationListeners.clear();
      stamped.clear();
      pending = [];
    },
  };
}
