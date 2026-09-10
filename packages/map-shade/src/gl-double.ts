// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A recording stand-in for a WebGL2 context.
 *
 * This container has no GPU, so it cannot prove a pixel. What it can prove is
 * the part that is logic rather than rendering: that a cell is rasterised once
 * and only when it is earned, that the lightmap is allocated as R8, that the
 * framebuffer and viewport a stamp borrows are handed back, and that the
 * render pass uses the matrix MapLibre supplied. Whether the result actually
 * looks like shade on a map is not something this can answer.
 */

export interface DrawCall {
  readonly mode: number;
  readonly first: number;
  readonly count: number;
  readonly framebuffer: unknown;
  readonly viewport: readonly number[];
}

export interface GlDouble {
  readonly gl: WebGL2RenderingContext;
  readonly draws: DrawCall[];
  readonly uniforms: Map<string, unknown>;
  readonly textureImages: { internalFormat: number; format: number }[];
  readonly deleted: string[];
  boundFramebuffer(): unknown;
  viewport(): readonly number[];
}

export function createGlDouble(): GlDouble {
  const draws: DrawCall[] = [];
  const uniforms = new Map<string, unknown>();
  const textureImages: { internalFormat: number; format: number }[] = [];
  const deleted: string[] = [];
  const enabled = new Set<number>();

  let framebuffer: unknown = null;
  let currentViewport: number[] = [0, 0, 800, 600];
  const locationNames = new Map<unknown, string>();

  const constants = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    R8: 0x8229,
    RED: 0x1903,
    UNSIGNED_BYTE: 0x1401,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    CLAMP_TO_EDGE: 0x812f,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    FRAMEBUFFER: 0x8d40,
    FRAMEBUFFER_BINDING: 0x8ca6,
    COLOR_ATTACHMENT0: 0x8ce0,
    COLOR_BUFFER_BIT: 0x4000,
    VIEWPORT: 0x0ba2,
    BLEND: 0x0be2,
    DEPTH_TEST: 0x0b71,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    TRIANGLES: 0x0004,
    TRIANGLE_FAN: 0x0006,
  };

  const gl = {
    ...constants,

    createShader: () => ({ kind: "shader" }),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    deleteShader: () => undefined,
    createProgram: () => ({ kind: "program" }),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    useProgram: () => undefined,
    deleteProgram: () => deleted.push("program"),

    createBuffer: () => ({ kind: "buffer" }),
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    deleteBuffer: () => deleted.push("buffer"),

    createTexture: () => ({ kind: "texture" }),
    bindTexture: () => undefined,
    deleteTexture: () => deleted.push("texture"),
    activeTexture: () => undefined,
    texParameteri: () => undefined,
    texImage2D: (
      _target: number,
      _level: number,
      internalFormat: number,
      _width: number,
      _height: number,
      _border: number,
      format: number,
    ) => {
      textureImages.push({ internalFormat, format });
    },

    createFramebuffer: () => ({ kind: "framebuffer" }),
    bindFramebuffer: (_target: number, value: unknown) => {
      framebuffer = value;
    },
    framebufferTexture2D: () => undefined,
    deleteFramebuffer: () => deleted.push("framebuffer"),

    getAttribLocation: (_program: unknown, name: string) => {
      const location = name.length;
      return location;
    },
    getUniformLocation: (_program: unknown, name: string) => {
      const location = { name };
      locationNames.set(location, name);
      return location;
    },
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,

    uniformMatrix4fv: (
      location: unknown,
      _transpose: boolean,
      value: unknown,
    ) => {
      uniforms.set(locationNames.get(location) ?? "?", value);
    },
    uniform1i: (location: unknown, value: unknown) => {
      uniforms.set(locationNames.get(location) ?? "?", value);
    },
    uniform1f: (location: unknown, value: unknown) => {
      uniforms.set(locationNames.get(location) ?? "?", value);
    },
    uniform3f: (location: unknown, ...value: number[]) => {
      uniforms.set(locationNames.get(location) ?? "?", value);
    },

    clearColor: () => undefined,
    clear: () => undefined,
    enable: (cap: number) => enabled.add(cap),
    disable: (cap: number) => enabled.delete(cap),
    isEnabled: (cap: number) => enabled.has(cap),
    blendFunc: () => undefined,
    viewport: (x: number, y: number, width: number, height: number) => {
      currentViewport = [x, y, width, height];
    },
    getParameter: (name: number) => {
      if (name === constants.FRAMEBUFFER_BINDING) return framebuffer;
      if (name === constants.VIEWPORT) return Int32Array.from(currentViewport);
      return null;
    },

    drawArrays: (mode: number, first: number, count: number) => {
      draws.push({
        mode,
        first,
        count,
        framebuffer,
        viewport: [...currentViewport],
      });
    },
  };

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    draws,
    uniforms,
    textureImages,
    deleted,
    boundFramebuffer: () => framebuffer,
    viewport: () => currentViewport,
  };
}
