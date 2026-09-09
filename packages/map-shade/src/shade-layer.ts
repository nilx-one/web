// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CellIndex,
  PresenceStore,
  ShadeSource,
} from "@nilx-one/presence-contract";
import { cellToBoundary } from "h3-js";
import {
  MercatorCoordinate,
  type CustomLayerInterface,
  type CustomRenderMethodInput,
  type Map as MapLibreMap,
  type MapMouseEvent,
} from "maplibre-gl";

import { createTapHandler, type CellTap } from "./pick";

export interface ShadeLayerOptions {
  readonly source: ShadeSource;
  readonly store: PresenceStore;
  readonly anchor: { readonly lng: number; readonly lat: number };
  readonly id?: string;
  readonly regionM?: number;
  readonly textureSize?: number;
  readonly shadeColor?: readonly [number, number, number];
  readonly shadeAlpha?: number;
  readonly onCellTap?: (tap: CellTap) => void | Promise<void>;
}

export interface ShadeLayer extends CustomLayerInterface {
  readonly region: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
}

const RASTER_VERTEX_SHADER = `#version 300 es
in vec2 a_clip;
void main() {
  gl_Position = vec4(a_clip, 0.0, 1.0);
}`;

const RASTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}`;

const SHADE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform mat4 u_matrix;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
}`;

const SHADE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_lightmap;
uniform vec3 u_shade_color;
uniform float u_shade_alpha;
out vec4 fragColor;
void main() {
  float lit = texture(u_lightmap, v_uv).r;
  fragColor = vec4(u_shade_color, u_shade_alpha * (1.0 - lit));
}`;

function shader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const value = gl.createShader(type);
  if (value === null) throw new Error("map-shade could not create a shader");
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(value) ?? "unknown shader failure";
    gl.deleteShader(value);
    throw new Error(`map-shade shader compile failed: ${reason}`);
  }
  return value;
}

function program(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const value = gl.createProgram();
  if (value === null) throw new Error("map-shade could not create a program");
  const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(value, vertex);
  gl.attachShader(value, fragment);
  gl.linkProgram(value);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) {
    const reason = gl.getProgramInfoLog(value) ?? "unknown link failure";
    gl.deleteProgram(value);
    throw new Error(`map-shade program link failed: ${reason}`);
  }
  return value;
}

function requireObject<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`map-shade could not create ${label}`);
  return value;
}

export function createShadeLayer(options: ShadeLayerOptions): ShadeLayer {
  const regionM = options.regionM ?? 20_000;
  const textureSize = options.textureSize ?? 2_048;
  const shadeColor = options.shadeColor ?? [0, 0, 0];
  const shadeAlpha = options.shadeAlpha ?? 0.82;
  const center = MercatorCoordinate.fromLngLat(options.anchor, 0);
  const half = (regionM / 2) * center.meterInMercatorCoordinateUnits();
  const region = {
    x0: center.x - half,
    y0: center.y - half,
    x1: center.x + half,
    y1: center.y + half,
  };
  const spanX = region.x1 - region.x0;
  const spanY = region.y1 - region.y0;
  const pending: CellIndex[] = [];
  const tap = createTapHandler({ source: options.source, store: options.store });

  let map: MapLibreMap | undefined;
  let rasterProgram: WebGLProgram | undefined;
  let shadeProgram: WebGLProgram | undefined;
  let lightmap: WebGLTexture | undefined;
  let framebuffer: WebGLFramebuffer | undefined;
  let cellBuffer: WebGLBuffer | undefined;
  let quadBuffer: WebGLBuffer | undefined;
  let rasterVertexArray: WebGLVertexArrayObject | undefined;
  let shadeVertexArray: WebGLVertexArrayObject | undefined;
  let matrixUniform: WebGLUniformLocation | null = null;
  let lightmapUniform: WebGLUniformLocation | null = null;
  let colorUniform: WebGLUniformLocation | null = null;
  let alphaUniform: WebGLUniformLocation | null = null;
  let unsubscribeSource: (() => void) | undefined;

  const onMapClick = (event: MapMouseEvent): void => {
    void tap(event.lngLat).then((hit) => {
      if (hit !== null) return options.onCellTap?.(hit);
      return undefined;
    });
  };

  function cellVertices(cell: CellIndex): Float32Array | null {
    const boundary = cellToBoundary(cell, true);
    const vertices = new Float32Array(boundary.length * 2);
    let intersects = false;
    for (let index = 0; index < boundary.length; index += 1) {
      const point = boundary[index];
      if (point === undefined) continue;
      const [lng, lat] = point;
      const coordinate = MercatorCoordinate.fromLngLat({ lng, lat }, 0);
      const u = (coordinate.x - region.x0) / spanX;
      const v = (coordinate.y - region.y0) / spanY;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) intersects = true;
      vertices[index * 2] = u * 2 - 1;
      vertices[index * 2 + 1] = v * 2 - 1;
    }
    return intersects ? vertices : null;
  }

  function flush(gl: WebGL2RenderingContext): void {
    if (
      pending.length === 0 ||
      rasterProgram === undefined ||
      framebuffer === undefined ||
      cellBuffer === undefined ||
      rasterVertexArray === undefined
    ) {
      return;
    }

    const previousFramebuffer = gl.getParameter(
      gl.FRAMEBUFFER_BINDING,
    ) as WebGLFramebuffer | null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const previousProgram = gl.getParameter(
      gl.CURRENT_PROGRAM,
    ) as WebGLProgram | null;
    const previousVertexArray = gl.getParameter(
      gl.VERTEX_ARRAY_BINDING,
    ) as WebGLVertexArrayObject | null;
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, textureSize, textureSize);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(rasterProgram);
    gl.bindVertexArray(rasterVertexArray);

    for (const cell of pending.splice(0)) {
      const vertices = cellVertices(cell);
      if (vertices === null) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, cellBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length / 2);
    }

    gl.bindVertexArray(previousVertexArray);
    gl.useProgram(previousProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.viewport(
      previousViewport[0] ?? 0,
      previousViewport[1] ?? 0,
      previousViewport[2] ?? 0,
      previousViewport[3] ?? 0,
    );
    if (blendEnabled) gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    if (depthEnabled) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
  }

  return {
    id: options.id ?? "nilx-one-presence-shade",
    type: "custom",
    renderingMode: "2d",
    region,

    onAdd(mountedMap, gl) {
      map = mountedMap;
      rasterProgram = program(gl, RASTER_VERTEX_SHADER, RASTER_FRAGMENT_SHADER);
      shadeProgram = program(gl, SHADE_VERTEX_SHADER, SHADE_FRAGMENT_SHADER);
      cellBuffer = requireObject(gl.createBuffer(), "cell buffer");
      quadBuffer = requireObject(gl.createBuffer(), "quad buffer");
      rasterVertexArray = requireObject(
        gl.createVertexArray(),
        "raster vertex array",
      );
      shadeVertexArray = requireObject(
        gl.createVertexArray(),
        "shade vertex array",
      );

      gl.bindVertexArray(rasterVertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, cellBuffer);
      const rasterAttribute = gl.getAttribLocation(rasterProgram, "a_clip");
      gl.enableVertexAttribArray(rasterAttribute);
      gl.vertexAttribPointer(rasterAttribute, 2, gl.FLOAT, false, 0, 0);

      const { x0, y0, x1, y1 } = region;
      gl.bindVertexArray(shadeVertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([
          x0,
          y0,
          0,
          0,
          x1,
          y0,
          1,
          0,
          x0,
          y1,
          0,
          1,
          x1,
          y1,
          1,
          1,
        ]),
        gl.STATIC_DRAW,
      );
      const positionAttribute = gl.getAttribLocation(shadeProgram, "a_position");
      const uvAttribute = gl.getAttribLocation(shadeProgram, "a_uv");
      const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
      gl.enableVertexAttribArray(positionAttribute);
      gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(uvAttribute);
      gl.vertexAttribPointer(
        uvAttribute,
        2,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);

      lightmap = requireObject(gl.createTexture(), "lightmap texture");
      const previousTexture = gl.getParameter(
        gl.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, textureSize, textureSize);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      framebuffer = requireObject(
        gl.createFramebuffer(),
        "lightmap framebuffer",
      );
      const previousFramebuffer = gl.getParameter(
        gl.FRAMEBUFFER_BINDING,
      ) as WebGLFramebuffer | null;
      const previousClear = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        lightmap,
        0,
      );
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          `map-shade framebuffer incomplete: 0x${status.toString(16)}`,
        );
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clearColor(
        previousClear[0] ?? 0,
        previousClear[1] ?? 0,
        previousClear[2] ?? 0,
        previousClear[3] ?? 0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);

      matrixUniform = gl.getUniformLocation(shadeProgram, "u_matrix");
      lightmapUniform = gl.getUniformLocation(shadeProgram, "u_lightmap");
      colorUniform = gl.getUniformLocation(shadeProgram, "u_shade_color");
      alphaUniform = gl.getUniformLocation(shadeProgram, "u_shade_alpha");

      pending.push(...options.source.litCells());
      unsubscribeSource = options.source.onCellLit((cell) => {
        pending.push(cell);
        map?.triggerRepaint();
      });
      mountedMap.on("click", onMapClick);
    },

    render(gl, frame: CustomRenderMethodInput) {
      if (
        shadeProgram === undefined ||
        lightmap === undefined ||
        shadeVertexArray === undefined
      ) {
        return;
      }
      flush(gl);

      const previousProgram = gl.getParameter(
        gl.CURRENT_PROGRAM,
      ) as WebGLProgram | null;
      const previousVertexArray = gl.getParameter(
        gl.VERTEX_ARRAY_BINDING,
      ) as WebGLVertexArrayObject | null;
      const previousActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
      gl.activeTexture(gl.TEXTURE0);
      const previousTexture = gl.getParameter(
        gl.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      const blendEnabled = gl.isEnabled(gl.BLEND);
      const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);
      const blendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB) as number;
      const blendDstRgb = gl.getParameter(gl.BLEND_DST_RGB) as number;
      const blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA) as number;
      const blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA) as number;

      gl.useProgram(shadeProgram);
      gl.bindVertexArray(shadeVertexArray);
      gl.uniformMatrix4fv(
        matrixUniform,
        false,
        new Float32Array(frame.defaultProjectionData.mainMatrix),
      );
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.uniform1i(lightmapUniform, 0);
      gl.uniform3fv(colorUniform, shadeColor);
      gl.uniform1f(alphaUniform, shadeAlpha);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.blendFuncSeparate(
        blendSrcRgb,
        blendDstRgb,
        blendSrcAlpha,
        blendDstAlpha,
      );
      if (blendEnabled) gl.enable(gl.BLEND);
      else gl.disable(gl.BLEND);
      if (depthEnabled) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
      gl.activeTexture(previousActiveTexture);
      gl.bindVertexArray(previousVertexArray);
      gl.useProgram(previousProgram);
    },

    onRemove(mountedMap, gl) {
      mountedMap.off("click", onMapClick);
      unsubscribeSource?.();
      unsubscribeSource = undefined;
      map = undefined;
      pending.length = 0;
      if (rasterProgram !== undefined) gl.deleteProgram(rasterProgram);
      if (shadeProgram !== undefined) gl.deleteProgram(shadeProgram);
      if (lightmap !== undefined) gl.deleteTexture(lightmap);
      if (framebuffer !== undefined) gl.deleteFramebuffer(framebuffer);
      if (cellBuffer !== undefined) gl.deleteBuffer(cellBuffer);
      if (quadBuffer !== undefined) gl.deleteBuffer(quadBuffer);
      if (rasterVertexArray !== undefined)
        gl.deleteVertexArray(rasterVertexArray);
      if (shadeVertexArray !== undefined) gl.deleteVertexArray(shadeVertexArray);
      rasterProgram = undefined;
      shadeProgram = undefined;
      lightmap = undefined;
      framebuffer = undefined;
      cellBuffer = undefined;
      quadBuffer = undefined;
      rasterVertexArray = undefined;
      shadeVertexArray = undefined;
    },
  };
}
