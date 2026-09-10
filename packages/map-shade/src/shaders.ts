// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Stamping a cell into the lightmap. The boundary arrives already in clip
 * space, so the vertex stage has nothing left to do.
 */
export const STAMP_VERTEX_SOURCE = `#version 300 es
in vec2 a_clip;

void main() {
  gl_Position = vec4(a_clip, 0.0, 1.0);
}
`;

/**
 * Phase 1's lightmap is a binary mask in a single R8 channel: a cell is either
 * somewhere the person has been or it is not. No timestamp, no decay, no
 * second channel — that is what keeps this phase small, and what a week of
 * real use is supposed to inform.
 */
export const STAMP_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

out vec4 fragColor;

void main() {
  fragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`;

/**
 * The shade quad. UV rides along as a varying, so the fragment stage samples
 * the lightmap without ever inverting the projection.
 */
export const SHADE_VERTEX_SOURCE = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;

uniform mat4 u_matrix;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`;

/**
 * Dark where the person has never been, clear where they have.
 *
 * The colour is premultiplied by its own alpha because MapLibre composites
 * custom layers with a premultiplied blend function; emitting straight alpha
 * here would wash the shade out towards white at the edges.
 */
export const SHADE_FRAGMENT_SOURCE = `#version 300 es
precision mediump float;

in vec2 v_uv;

uniform sampler2D u_lightmap;
uniform vec3 u_shadeColor;
uniform float u_shadeAlpha;

out vec4 fragColor;

void main() {
  float lit = texture(u_lightmap, v_uv).r;
  float alpha = u_shadeAlpha * (1.0 - lit);
  fragColor = vec4(u_shadeColor * alpha, alpha);
}
`;
