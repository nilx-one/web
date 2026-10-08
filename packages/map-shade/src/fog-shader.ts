// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { MAX_FOG_ZONES } from "./fog-palette";

export const FOG_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform mat4 u_matrix;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
}`;

/**
 * The fog, drawn as mist rather than a flat veil.
 *
 * Everything the mist is made of lives on the ground: its octaves sit at fixed
 * world wavelengths, so a wisp stays over the street it drifts across while
 * the camera moves. Which octaves are drawn follows the zoom, so the mist has
 * the same grain from city to street, and the finest and coarsest cross-fade
 * by the fractional level so zooming never pops.
 *
 * The lightmap says where the fog is lifted. Its mip chain is what softens
 * the frontier: one level blurs the border so the mist can fray it into
 * wisps, a wider one is the light that open ground throws into the mist
 * beside it.
 *
 * Output is premultiplied, as MapLibre composites, so a palette's bloom can
 * add light past the mist's own edge.
 */
export const FOG_FRAGMENT_SHADER = `#version 300 es
precision highp float;

#define MAX_ZONES ${MAX_FOG_ZONES}
#define MIST_OCTAVES 5
#define DRIFT_RATE 0.014

in vec2 v_uv;

uniform sampler2D u_lightmap;
uniform float u_region_m;
uniform float u_time;
uniform float u_mpp;
uniform float u_pixel_ratio;
uniform vec2 u_viewport;
uniform float u_haze;
uniform float u_edge_lod;
uniform float u_halo_lod;
uniform float u_density;

uniform vec3 u_shadow;
uniform vec3 u_light;
uniform vec3 u_glow;
uniform float u_bloom;

uniform int u_zone_count;
uniform vec4 u_zone_shape[MAX_ZONES];
uniform vec3 u_zone_shadow[MAX_ZONES];
uniform vec3 u_zone_light[MAX_ZONES];
uniform vec4 u_zone_glow[MAX_ZONES];

out vec4 fragColor;

// Hashes without sine: stable on mobile GPUs at the large lattice
// coordinates a city-sized region reaches.
float hash1(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

// Gradient noise, roughly -0.7..0.7, quintic so its slope is smooth too.
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i), f);
  float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Octave k has wavelength 2^k metres. Its weight fades in or out only at the
// ends of the band the zoom selects, and every octave drifts at its own
// wavelength's pace in its own direction, so the mist churns instead of
// sliding past as one sheet.
float mist(vec2 m, float lod, float t) {
  float base = floor(lod);
  float f = lod - base;
  float sum = 0.0;
  float norm = 0.0;
  for (int i = 0; i <= MIST_OCTAVES; i++) {
    float k = base + float(i);
    float fade = i == 0 ? 1.0 - f : (i == MIST_OCTAVES ? f : 1.0);
    float weight = exp2(float(i) * 0.8) * fade;
    float angle = k * 2.39996;
    vec2 wind = vec2(0.82, -0.36) + 0.34 * vec2(cos(angle), sin(angle));
    vec2 q = m / exp2(k) + wind * (t * DRIFT_RATE) + vec2(k * 31.7, k * -17.3);
    sum += weight * gnoise(q);
    norm += weight;
  }
  return sum / norm;
}

// A slow displacement, in metres, that curls the mist and frays the frontier.
vec2 curl(vec2 m, float lod, float t) {
  float base = floor(lod);
  float f = lod - base;
  vec2 sum = vec2(0.0);
  float norm = 0.0;
  for (int i = 0; i <= 2; i++) {
    float k = base + float(i);
    float fade = i == 0 ? 1.0 - f : (i == 2 ? f : 1.0);
    float wavelength = exp2(k);
    vec2 q = m / wavelength + vec2(-0.5, 0.7) * (t * DRIFT_RATE * 0.7)
      + vec2(k * 11.3, k * 5.9);
    sum += fade * wavelength * vec2(gnoise(q), gnoise(q + vec2(41.7, 23.1)));
    norm += fade;
  }
  return sum / norm;
}

// Sparse specks of light at a fixed ground lattice, each twinkling on its
// own clock. Two lattice sizes cross-fade with the zoom like the mist does.
float motes(vec2 m, float lod, float t) {
  float base = floor(lod);
  float f = lod - base;
  float result = 0.0;
  for (int i = 0; i < 2; i++) {
    float k = base + float(i);
    float cell = exp2(k);
    vec2 g = m / cell + vec2(0.6, -0.25) * (t * DRIFT_RATE * 1.6);
    vec2 id = floor(g) + vec2(k * 7.13, k * 3.71);
    float chance = hash1(id);
    if (chance > 0.16) continue;
    vec2 at = vec2(hash1(id + 3.7), hash1(id + 9.1)) * 0.7 + 0.15;
    float px = length(fract(g) - at) * cell / u_mpp;
    float size = mix(0.7, 1.7, hash1(id + 5.5));
    float twinkle = 0.5 + 0.5 * sin(t * mix(0.7, 2.1, hash1(id + 1.3)) + chance * 60.0);
    twinkle = twinkle * twinkle * twinkle * twinkle;
    float fade = i == 0 ? 1.0 - f : f;
    result += exp(-(px * px) / (size * size)) * twinkle * fade;
  }
  return result;
}

void main() {
  // Ground well inside what is revealed: nothing to draw, nothing to spend.
  float halo = textureLod(u_lightmap, v_uv, u_halo_lod).r;
  if (halo > 0.998) discard;

  vec2 m = (v_uv - 0.5) * u_region_m;
  float lod = log2(max(u_mpp, 1e-3) * 20.0);
  float t = u_time;

  vec2 bend = curl(m, lod + 3.0, t);
  float cloud = clamp(mist(m + bend * 0.35, lod, t) * 1.3 + 0.5, 0.0, 1.0);

  // The frontier: a blurred border, frayed by the same mist that covers it.
  vec2 shift = bend * 0.5;
  shift *= min(1.0, 42.0 / max(length(shift), 1e-3));
  float edge = textureLod(u_lightmap, v_uv + shift / u_region_m, u_edge_lod).r;
  float border = 4.0 * edge * (1.0 - edge);
  float fog = smoothstep(0.3, 0.7, 1.0 - edge + (cloud - 0.5) * 0.95 * border);
  float seam = border * fog;

  // Relief: mist banked toward the light is brighter, the lee side darker.
  // Transform the screen derivatives back into a ground gradient. This
  // keeps the light direction fixed across bearing/pitch changes without
  // evaluating the expensive mist octaves again for neighbouring points.
  vec2 dx = dFdx(m);
  vec2 dy = dFdy(m);
  vec2 dc = vec2(dFdx(cloud), dFdy(cloud));
  float determinant = dx.x * dy.y - dx.y * dy.x;
  vec2 slope = abs(determinant) > 1e-6
    ? vec2(dc.x * dy.y - dc.y * dx.y, dc.y * dx.x - dc.x * dy.x) / determinant
    : vec2(0.0);
  slope *= exp2(lod) * 1.8;
  float relief = clamp(dot(slope, vec2(-0.34, 0.94)), -1.0, 1.0);

  vec3 shadow = u_shadow;
  vec3 light = u_light;
  vec3 glow = u_glow;
  float bloom = u_bloom;
  for (int i = 0; i < MAX_ZONES; i++) {
    if (i >= u_zone_count) break;
    vec4 shape = u_zone_shape[i];
    float feather = max(shape.w, 1.0);
    float d = distance(m, shape.xy) + (cloud - 0.5) * feather * 0.9;
    float w = 1.0 - smoothstep(shape.z, shape.z + feather, d);
    shadow = mix(shadow, u_zone_shadow[i], w);
    light = mix(light, u_zone_light[i], w);
    glow = mix(glow, u_zone_glow[i].rgb, w);
    bloom = mix(bloom, u_zone_glow[i].a, w);
  }

  float body = smoothstep(0.12, 0.88, cloud);
  vec3 color = mix(shadow, light, clamp(body + relief * 0.3, 0.0, 1.0));

  // Aerial perspective: under a pitched camera the far mist pales toward
  // the sky, and slow shafts of light fall through it from above.
  float screenY = gl_FragCoord.y / max(u_viewport.y, 1.0);
  float distance01 = smoothstep(0.25, 1.0, screenY) * u_haze;
  float across = dot(m, vec2(0.94, 0.34)) / 150.0;
  float shafts = smoothstep(0.08, 0.42, gnoise(vec2(across, t * 0.035)));
  shafts *= 0.65;
  color = mix(color, light, distance01 * 0.45 + shafts * 0.16);

  // Open ground throws its light into the mist beside it.
  float rim = halo * fog;
  color = mix(color, mix(glow, light, 0.25), clamp(rim * 0.38 + seam * 0.42, 0.0, 0.75));

  float sparkle = motes(m, log2(max(u_mpp, 1e-3) * 34.0), t) * fog;
  sparkle *= 0.45 + 0.55 * max(halo, body);
  color = mix(color, mix(glow, vec3(1.0), 0.65), clamp(sparkle, 0.0, 1.0));

  float alpha = fog * u_density * mix(0.97, 1.0, body) * (1.0 - rim * 0.1);
  alpha = mix(alpha, fog * u_density, distance01);
  alpha = max(alpha, clamp(sparkle, 0.0, 1.0) * fog);

  // Bloom: the glow as added light, over the seam and just past it.
  float outside = (1.0 - fog) * (1.0 - halo);
  vec3 spill = glow * bloom * (seam * 0.55 + sparkle * 0.8 + outside * 0.22);
  fragColor = vec4(color * alpha + spill, alpha);
}`;
