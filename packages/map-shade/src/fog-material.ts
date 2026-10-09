// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MercatorCoordinate } from "maplibre-gl";

import type { FogAtlas } from "./fog-atlas";
import {
  DEFAULT_FOG_ZONE_FEATHER_M,
  MAX_FOG_ZONES,
  type FogColor,
  type FogPalette,
  type FogZone,
} from "./fog-palette";

export const FOG_PARAMETER_VECTORS = 4 + MAX_FOG_ZONES * 4;

/**
 * The mist's mean colour: what its clouds average to, and what they settle
 * into at the atlas edge, where the flat world fog takes over seamlessly.
 */
export function fogFloor(palette: FogPalette): FogColor {
  return [0, 1, 2].map(
    (channel) => (palette.shadow[channel]! + palette.light[channel]!) / 2,
  ) as unknown as FogColor;
}

/** `fogFloor` as a CSS colour, for the canvas veil and the world fog. */
export function fogFloorCss(palette: FogPalette, alpha = 1): string {
  const [r, g, b] = fogFloor(palette).map((value) => Math.round(value * 255));
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

/**
 * Shared ABI for both GPU backends; all distances are world metres.
 * `footprintM` is how much ground one screen pixel covers: the clouds keep
 * only the octaves wide enough to read as mist at that scale.
 */
export function fogParameters(
  atlas: FogAtlas,
  palette: FogPalette,
  zones: readonly FogZone[],
  time: number,
  density: number,
  footprintM = 0,
): Float32Array<ArrayBuffer> {
  const data = new Float32Array(FOG_PARAMETER_VECTORS * 4);
  data.set([atlas.regionM, time, density, zones.length]);
  data.set([...palette.shadow, palette.bloom], 4);
  data.set([...palette.light, footprintM], 8);
  data.set(palette.glow, 12);
  zones.forEach((zone, index) => {
    const point = MercatorCoordinate.fromLngLat(zone.center);
    const x = point.x + Math.round(atlas.center.x - point.x);
    const offset = 16 + index * 16;
    data.set(
      [
        ((x - atlas.center.x) / atlas.span) * atlas.regionM,
        ((point.y - atlas.center.y) / atlas.span) * atlas.regionM,
        zone.radiusM,
        zone.featherM ?? DEFAULT_FOG_ZONE_FEATHER_M,
      ],
      offset,
    );
    data.set([...zone.palette.shadow, zone.palette.bloom], offset + 4);
    data.set(zone.palette.light, offset + 8);
    data.set(zone.palette.glow, offset + 12);
  });
  return data;
}

// Mask sampling, wavelengths, colour and animation agree across these two
// shader dialects. Coverage is tested FIRST, and never displaced by noise.
// noise2(m / s) repeats every 2πs metres, a regular weave: each octave
// fades out as its period shrinks from 192 to 64 screen pixels (p[2].w is
// metres per pixel), so a zoomed-out map reads as even mist, not fabric.
// Over the outer tenth of the atlas the clouds and zones settle into the
// palette's opaque floor colour, which the flat world fog beyond it wears:
// where the two overlap, opaque over opaque leaves no seam.
export const ATLAS_GLSL = `#version 300 es
precision highp float;
uniform sampler2D u_mask;
uniform vec4 p[${FOG_PARAMETER_VECTORS}];
in vec2 uv;
out vec4 color;
float noise2(vec2 q) {
  return sin(q.x + sin(q.y * 0.73)) * sin(q.y + sin(q.x * 0.61));
}
void main() {
  if (texture(u_mask, uv).r > 0.001) { color = vec4(0.0); return; }
  vec2 m = (uv - 0.5) * p[0].x;
  vec2 wind = vec2(p[0].y * 0.7, p[0].y * -0.3);
  float f = p[2].w / 6.2832;
  float cloud = 0.5 + 0.22 * (1.0 - smoothstep(80.0 / 192.0, 80.0 / 64.0, f)) * noise2((m + wind) / 80.0) + 0.16 * (1.0 - smoothstep(210.0 / 192.0, 210.0 / 64.0, f)) * noise2((m - wind * 0.4) / 210.0) + 0.1 * (1.0 - smoothstep(530.0 / 192.0, 530.0 / 64.0, f)) * noise2(m / 530.0);
  float edge = smoothstep(0.4 * p[0].x, 0.5 * p[0].x, max(abs(m.x), abs(m.y)));
  cloud = mix(cloud, 0.5, edge);
  vec3 shadow = p[1].rgb; vec3 light = p[2].rgb; vec3 glow = p[3].rgb;
  for (int i = 0; i < ${MAX_FOG_ZONES}; i++) {
    if (float(i) >= p[0].w) break;
    int j = 4 + i * 4;
    float w = (1.0 - smoothstep(p[j].z, p[j].z + p[j].w, distance(m, p[j].xy))) * (1.0 - edge);
    shadow = mix(shadow, p[j+1].rgb, w); light = mix(light, p[j+2].rgb, w); glow = mix(glow, p[j+3].rgb, w);
  }
  vec2 d = vec2(60.0 / p[0].x, 0.0);
  float rim = (texture(u_mask, uv+d).r + texture(u_mask, uv-d).r + texture(u_mask, uv+d.yx).r + texture(u_mask, uv-d.yx).r) * 0.25;
  vec3 rgb = mix(mix(shadow, light, cloud), glow, rim * 0.65);
  float alpha = mix(p[0].z, 1.0, edge);
  color = vec4(rgb * alpha, alpha);
}`;

export const ATLAS_WGSL = `
struct Parameters { p: array<vec4f, ${FOG_PARAMETER_VECTORS}> }
@group(0) @binding(0) var mask: texture_2d<f32>;
@group(0) @binding(1) var sampleMask: sampler;
@group(0) @binding(2) var<uniform> params: Parameters;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
  let xy = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
  var out: Vertex;
  out.position = vec4f(xy[index], 0, 1);
  out.uv = vec2f((xy[index].x + 1) * 0.5, (1 - xy[index].y) * 0.5);
  return out;
}
fn noise2(q: vec2f) -> f32 {
  return sin(q.x + sin(q.y * 0.73)) * sin(q.y + sin(q.x * 0.61));
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  let p = params.p;
  let uv = input.uv;
  if (textureSampleLevel(mask, sampleMask, uv, 0).r > 0.001) { return vec4f(0); }
  let m = (uv - 0.5) * p[0].x;
  let wind = vec2f(p[0].y * 0.7, p[0].y * -0.3);
  let edge = smoothstep(0.4 * p[0].x, 0.5 * p[0].x, max(abs(m.x), abs(m.y)));
  let f = p[2].w / 6.2832;
  let cloud = mix(0.5 + 0.22 * (1 - smoothstep(80.0 / 192.0, 80.0 / 64.0, f)) * noise2((m + wind) / 80.0) + 0.16 * (1 - smoothstep(210.0 / 192.0, 210.0 / 64.0, f)) * noise2((m - wind * 0.4) / 210.0) + 0.1 * (1 - smoothstep(530.0 / 192.0, 530.0 / 64.0, f)) * noise2(m / 530.0), 0.5, edge);
  var shadow = p[1].rgb; var light = p[2].rgb; var glow = p[3].rgb;
  for (var i = 0u; i < ${MAX_FOG_ZONES}u; i++) {
    if (f32(i) >= p[0].w) { break; }
    let j = 4u + i * 4u;
    let w = (1 - smoothstep(p[j].z, p[j].z + p[j].w, distance(m, p[j].xy))) * (1 - edge);
    shadow = mix(shadow, p[j+1].rgb, w); light = mix(light, p[j+2].rgb, w); glow = mix(glow, p[j+3].rgb, w);
  }
  let d = vec2f(60 / p[0].x, 0);
  let rim = (textureSampleLevel(mask, sampleMask, uv+d, 0).r + textureSampleLevel(mask, sampleMask, uv-d, 0).r + textureSampleLevel(mask, sampleMask, uv+d.yx, 0).r + textureSampleLevel(mask, sampleMask, uv-d.yx, 0).r) * 0.25;
  let rgb = mix(mix(shadow, light, cloud), glow, rim * 0.65);
  let alpha = mix(p[0].z, 1, edge);
  return vec4f(rgb * alpha, alpha);
}`;
