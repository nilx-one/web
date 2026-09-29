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

import {
  LIGHT_FOG_PALETTE,
  DEFAULT_FOG_ZONE_FEATHER_M,
  MAX_FOG_ZONES,
  requireFogPalette,
  requireFogZones,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
import { FOG_FRAGMENT_SHADER, FOG_VERTEX_SHADER } from "./fog-shader";
import { createTapHandler, type CellTap } from "./pick";

export interface ShadeLayerOptions {
  readonly source: ShadeSource;
  readonly store: PresenceStore;
  readonly anchor: { readonly lng: number; readonly lat: number };
  readonly id?: string;
  readonly regionM?: number;
  readonly textureSize?: number;
  /** How opaque the deepest fog is. */
  readonly shadeAlpha?: number;
  /** How the fog is lit wherever no zone says otherwise. */
  readonly palette?: FogPalette;
  /** Stretches of fog wearing their own palette, blended over `palette`. */
  readonly zones?: readonly FogZone[];
  /**
   * Whether the mist drifts. `"still"` draws the same mist, frozen, and never
   * asks for a frame of its own — for a person who asked not to be moved.
   */
  readonly motion?: "drift" | "still";
  /**
   * How often drifting mist asks for a frame. Every one it asks for redraws
   * the whole map, and mist is slow: film's 24 fps is plenty.
   */
  readonly frameIntervalMs?: number;
  /** Test seams for the drift's clock. */
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => () => void;
  /**
   * Cells rasterized into the lightmap per flush. A cold-loaded journal can
   * hand the layer thousands of already-lit cells at once; draining all of
   * them in the frame that adds the layer would turn mount into a single
   * long synchronous stall. Bounding the batch keeps every frame's cost the
   * same whether it is filling a week of history or lighting the one cell a
   * person just walked into.
   */
  readonly cellsPerFlush?: number;
  readonly onCellTap?: (tap: CellTap) => void | Promise<void>;
}

export interface ShadeLayer extends CustomLayerInterface {
  readonly region: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  /** Whether this layer's mist drifts or holds still. */
  readonly motion: "drift" | "still";
  /** Relight the fog outside every zone, e.g. when the appearance changes. */
  setPalette(palette: FogPalette): void;
  /** Replace the zones the fog blends. At most `MAX_FOG_ZONES`. */
  setZones(zones: readonly FogZone[]): void;
}

/**
 * Lightmap mip levels: level 0 holds the cells as drawn, and each level up is
 * a wider blur of them, which is what the shader softens the frontier and
 * throws the open ground's light with. 2048 texels down to 64.
 */
const LIGHTMAP_LEVELS = 6;

/** The frontier's blur: at least this many metres, or pixels, whichever is wider. */
const EDGE_BLUR_M = 18;
const EDGE_BLUR_PX = 10;
/** How far open ground's light reaches into the mist. */
const HALO_BLUR_M = 70;
const HALO_BLUR_PX = 36;

/** MapLibre's zoom 0 spans the world in 512 CSS pixels. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const WORLD_TILE_PX = 512;

const FOG_UNIFORMS = [
  "u_matrix",
  "u_lightmap",
  "u_region_m",
  "u_time",
  "u_mpp",
  "u_pixel_ratio",
  "u_viewport",
  "u_haze",
  "u_edge_lod",
  "u_halo_lod",
  "u_density",
  "u_shadow",
  "u_light",
  "u_glow",
  "u_bloom",
  "u_zone_count",
  "u_zone_shape",
  "u_zone_shadow",
  "u_zone_light",
  "u_zone_glow",
] as const;

type FogUniform = (typeof FOG_UNIFORMS)[number];

function defaultSchedule(callback: () => void, delayMs: number): () => void {
  const handle = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(handle);
}

function defaultNow(): number {
  return globalThis.performance?.now() ?? Date.now();
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

/**
 * A batch size of 0 or less would make `flush` splice nothing out of
 * `pending` on every call, so the backlog never shrinks while `pending.length
 * > 0` keeps asking for another frame — an infinite repaint loop that lights
 * no cell. Failing here, once, beats that loop failing to fail anywhere.
 */
function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `map-shade ${label} must be a positive integer, got ${value}`,
    );
  }
  return value;
}

export function createShadeLayer(options: ShadeLayerOptions): ShadeLayer {
  const regionM = options.regionM ?? 20_000;
  const textureSize = options.textureSize ?? 2_048;
  const shadeAlpha = options.shadeAlpha ?? 0.97;
  let palette = options.palette ?? LIGHT_FOG_PALETTE;
  requireFogPalette(palette, "palette");
  const motion = options.motion ?? "drift";
  const frameIntervalMs = options.frameIntervalMs ?? 1_000 / 24;
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) {
    throw new Error(
      `map-shade frameIntervalMs must be a positive number, got ${frameIntervalMs}`,
    );
  }
  const now = options.now ?? defaultNow;
  const schedule = options.schedule ?? defaultSchedule;
  const startedAt = now();
  const cellsPerFlush = requirePositiveInteger(
    options.cellsPerFlush ?? 512,
    "cellsPerFlush",
  );
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
  const texelM = regionM / textureSize;
  const zoneShape = new Float32Array(MAX_FOG_ZONES * 4);
  const zoneShadow = new Float32Array(MAX_FOG_ZONES * 3);
  const zoneLight = new Float32Array(MAX_FOG_ZONES * 3);
  const zoneGlow = new Float32Array(MAX_FOG_ZONES * 4);
  let zoneCount = 0;

  /** Zones as the shader reads them: metres from the region's centre. */
  function packZones(zones: readonly FogZone[]): void {
    requireFogZones(zones);
    zoneShape.fill(0);
    zoneShadow.fill(0);
    zoneLight.fill(0);
    zoneGlow.fill(0);
    zones.forEach((zone, index) => {
      const at = MercatorCoordinate.fromLngLat(zone.center, 0);
      zoneShape.set(
        [
          ((at.x - region.x0) / spanX - 0.5) * regionM,
          ((at.y - region.y0) / spanY - 0.5) * regionM,
          zone.radiusM,
          zone.featherM ?? DEFAULT_FOG_ZONE_FEATHER_M,
        ],
        index * 4,
      );
      zoneShadow.set(zone.palette.shadow, index * 3);
      zoneLight.set(zone.palette.light, index * 3);
      zoneGlow.set([...zone.palette.glow, zone.palette.bloom], index * 4);
    });
    zoneCount = zones.length;
  }
  packZones(options.zones ?? []);
  const pending: CellIndex[] = [];
  const tap = createTapHandler({
    source: options.source,
    store: options.store,
  });

  let map: MapLibreMap | undefined;
  let rasterProgram: WebGLProgram | undefined;
  let shadeProgram: WebGLProgram | undefined;
  let lightmap: WebGLTexture | undefined;
  let framebuffer: WebGLFramebuffer | undefined;
  let cellBuffer: WebGLBuffer | undefined;
  let quadBuffer: WebGLBuffer | undefined;
  let rasterVertexArray: WebGLVertexArrayObject | undefined;
  let shadeVertexArray: WebGLVertexArrayObject | undefined;
  let uniforms: Partial<Record<FogUniform, WebGLUniformLocation | null>> = {};
  let unsubscribeSource: (() => void) | undefined;
  let cancelDrift: (() => void) | undefined;

  /**
   * Drifting mist asks for its next frame once this one is drawn, at most
   * every `frameIntervalMs`. A hidden page draws no frames, so the chain
   * pauses with it and picks up again on the first frame it draws.
   */
  function scheduleDrift(): void {
    if (motion !== "drift" || map === undefined || cancelDrift !== undefined) {
      return;
    }
    cancelDrift = schedule(() => {
      cancelDrift = undefined;
      map?.triggerRepaint();
    }, frameIntervalMs);
  }

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
    const previousArrayBuffer = gl.getParameter(
      gl.ARRAY_BUFFER_BINDING,
    ) as WebGLBuffer | null;
    const blendEnabled = gl.isEnabled(gl.BLEND);
    const depthEnabled = gl.isEnabled(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, textureSize, textureSize);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(rasterProgram);
    gl.bindVertexArray(rasterVertexArray);

    for (const cell of pending.splice(0, cellsPerFlush)) {
      const vertices = cellVertices(cell);
      if (vertices === null) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, cellBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length / 2);
    }

    // The blurred levels are what the frontier is softened and lit from, so
    // they follow every batch of cells drawn into level 0.
    if (lightmap !== undefined) {
      const previousTexture = gl.getParameter(
        gl.TEXTURE_BINDING_2D,
      ) as WebGLTexture | null;
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    }

    // A batch capped below the full backlog leaves cells still pending; the
    // next frame's prerender is where they get drawn, not a repaint this
    // layer would otherwise have no reason to ask for.
    if (pending.length > 0) map?.triggerRepaint();

    gl.bindBuffer(gl.ARRAY_BUFFER, previousArrayBuffer);
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
    motion,

    setPalette(next) {
      if (next === palette) return;
      requireFogPalette(next, "palette");
      palette = next;
      map?.triggerRepaint();
    },

    setZones(zones) {
      packZones(zones);
      map?.triggerRepaint();
    },

    onAdd(mountedMap, gl) {
      map = mountedMap;
      rasterProgram = program(gl, RASTER_VERTEX_SHADER, RASTER_FRAGMENT_SHADER);
      shadeProgram = program(gl, FOG_VERTEX_SHADER, FOG_FRAGMENT_SHADER);
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
      const positionAttribute = gl.getAttribLocation(
        shadeProgram,
        "a_position",
      );
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
      gl.texStorage2D(
        gl.TEXTURE_2D,
        LIGHTMAP_LEVELS,
        gl.R8,
        textureSize,
        textureSize,
      );
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
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
      const previousClear = gl.getParameter(
        gl.COLOR_CLEAR_VALUE,
      ) as Float32Array;
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
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.clearColor(
        previousClear[0] ?? 0,
        previousClear[1] ?? 0,
        previousClear[2] ?? 0,
        previousClear[3] ?? 0,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);

      const fogProgram = shadeProgram;
      uniforms = Object.fromEntries(
        FOG_UNIFORMS.map((name) => [
          name,
          gl.getUniformLocation(fogProgram, name),
        ]),
      );

      pending.push(...options.source.litCells());
      unsubscribeSource = options.source.onCellLit((cell) => {
        pending.push(cell);
        map?.triggerRepaint();
      });
      mountedMap.on("click", onMapClick);
    },

    prerender(gl) {
      // MapLibre's custom-layer contract reserves prerender for offscreen
      // texture work. Keep the journal-derived raster update out of main-map
      // rendering so render() remains one bounded quad draw.
      flush(gl);
    },

    render(gl, frame: CustomRenderMethodInput) {
      if (
        shadeProgram === undefined ||
        lightmap === undefined ||
        shadeVertexArray === undefined
      ) {
        return;
      }

      const previousProgram = gl.getParameter(
        gl.CURRENT_PROGRAM,
      ) as WebGLProgram | null;
      const previousVertexArray = gl.getParameter(
        gl.VERTEX_ARRAY_BINDING,
      ) as WebGLVertexArrayObject | null;
      const previousActiveTexture = gl.getParameter(
        gl.ACTIVE_TEXTURE,
      ) as number;
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

      const zoom = map?.getZoom() ?? 0;
      const latitude = map?.getCenter().lat ?? 0;
      const metresPerPixel =
        (EARTH_CIRCUMFERENCE_M * Math.cos((latitude * Math.PI) / 180)) /
        (WORLD_TILE_PX * 2 ** zoom);
      const pixelRatio = map?.getPixelRatio() ?? 1;
      const pitch = map?.getPitch() ?? 0;
      const blurLod = (metres: number, pixels: number): number =>
        Math.min(
          LIGHTMAP_LEVELS - 1,
          Math.max(
            0,
            Math.log2(Math.max(metres, pixels * metresPerPixel) / texelM),
          ),
        );

      gl.useProgram(shadeProgram);
      gl.bindVertexArray(shadeVertexArray);
      gl.uniformMatrix4fv(
        uniforms.u_matrix ?? null,
        false,
        new Float32Array(frame.defaultProjectionData.mainMatrix),
      );
      gl.bindTexture(gl.TEXTURE_2D, lightmap);
      gl.uniform1i(uniforms.u_lightmap ?? null, 0);
      gl.uniform1f(uniforms.u_region_m ?? null, regionM);
      gl.uniform1f(
        uniforms.u_time ?? null,
        motion === "drift" ? (now() - startedAt) / 1_000 : 0,
      );
      gl.uniform1f(uniforms.u_mpp ?? null, metresPerPixel);
      gl.uniform1f(uniforms.u_pixel_ratio ?? null, pixelRatio);
      gl.uniform2f(
        uniforms.u_viewport ?? null,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
      );
      gl.uniform1f(
        uniforms.u_haze ?? null,
        Math.min(1, Math.max(0, (pitch - 10) / 45)),
      );
      gl.uniform1f(
        uniforms.u_edge_lod ?? null,
        blurLod(EDGE_BLUR_M, EDGE_BLUR_PX),
      );
      gl.uniform1f(
        uniforms.u_halo_lod ?? null,
        blurLod(HALO_BLUR_M, HALO_BLUR_PX),
      );
      gl.uniform1f(uniforms.u_density ?? null, shadeAlpha);
      gl.uniform3fv(uniforms.u_shadow ?? null, palette.shadow);
      gl.uniform3fv(uniforms.u_light ?? null, palette.light);
      gl.uniform3fv(uniforms.u_glow ?? null, palette.glow);
      gl.uniform1f(uniforms.u_bloom ?? null, palette.bloom);
      gl.uniform1i(uniforms.u_zone_count ?? null, zoneCount);
      gl.uniform4fv(uniforms.u_zone_shape ?? null, zoneShape);
      gl.uniform3fv(uniforms.u_zone_shadow ?? null, zoneShadow);
      gl.uniform3fv(uniforms.u_zone_light ?? null, zoneLight);
      gl.uniform4fv(uniforms.u_zone_glow ?? null, zoneGlow);
      gl.enable(gl.BLEND);
      // The fog shader writes premultiplied colour, as MapLibre composites.
      gl.blendFuncSeparate(
        gl.ONE,
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

      scheduleDrift();
    },

    onRemove(mountedMap, gl) {
      mountedMap.off("click", onMapClick);
      unsubscribeSource?.();
      unsubscribeSource = undefined;
      cancelDrift?.();
      cancelDrift = undefined;
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
      if (shadeVertexArray !== undefined)
        gl.deleteVertexArray(shadeVertexArray);
      rasterProgram = undefined;
      shadeProgram = undefined;
      lightmap = undefined;
      framebuffer = undefined;
      cellBuffer = undefined;
      quadBuffer = undefined;
      rasterVertexArray = undefined;
      shadeVertexArray = undefined;
      uniforms = {};
    },
  };
}
