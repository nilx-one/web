// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The Dock glass on the GPU. Compute kernels step the spring network that
 * physics.ts describes; the render shaders draw every block as a slab of
 * smoky glass that refracts the world behind it, and the ribbons as light.
 */

const NETWORK = /* wgsl */ `
struct Frame { restLocal: vec4f, springs: vec4f, identity: vec4f };
struct State { motion: vec4f, rest: vec4f };
struct Sim { dt: f32, h: f32, teleport: f32, reset: f32, count: u32, p0: u32, p1: u32, p2: u32 };
`;

/** Takes the frame's rest positions; the nodes keep their own velocity. */
export const ADVANCE_WGSL = /* wgsl */ `${NETWORK}
@group(0) @binding(0) var<storage, read> frames: array<Frame>;
@group(0) @binding(1) var<storage, read_write> state: array<State>;
@group(0) @binding(2) var<uniform> sim: Sim;

@compute @workgroup_size(64)
fn advance(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= sim.count) { return; }
  let rest = frames[i].restLocal.xy;
  var s = state[i];
  if (sim.reset > 0.5) {
    s.motion = vec4f(0.0);
    s.rest = vec4f(0.0, 0.0, rest);
  } else {
    let jump = rest - s.rest.zw;
    if (length(jump) > sim.teleport || sim.dt <= 0.0) {
      s.rest = vec4f(0.0, 0.0, rest);
    } else {
      let velocity = jump / sim.dt;
      s.motion = vec4f(s.motion.xy, s.motion.zw + s.rest.xy - velocity);
      s.rest = vec4f(velocity, rest);
    }
  }
  state[i] = s;
}
`;

/** One substep of the springs, from one state buffer into the other. */
export const RELAX_WGSL = /* wgsl */ `${NETWORK}
@group(0) @binding(0) var<storage, read> frames: array<Frame>;
@group(0) @binding(1) var<storage, read> neighbours: array<vec4i>;
@group(0) @binding(2) var<storage, read> src: array<State>;
@group(0) @binding(3) var<storage, read_write> dst: array<State>;
@group(0) @binding(4) var<uniform> sim: Sim;

@compute @workgroup_size(64)
fn relax(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= sim.count) { return; }
  let s = src[i];
  let offset = s.motion.xy;
  let near = neighbours[i];
  var pull = vec2f(0.0);
  for (var k = 0; k < 4; k++) {
    let other = near[k];
    if (other >= 0) { pull += src[u32(other)].motion.xy - offset; }
  }
  let springs = frames[i].springs;
  let force = -springs.x * offset + springs.y * pull - springs.z * s.motion.zw;
  let velocity = s.motion.zw + force * sim.h;
  var next = offset + velocity * sim.h;
  let reach = length(next);
  if (reach > springs.w) { next *= springs.w / reach; }
  dst[i] = State(vec4f(next, velocity), s.rest);
}
`;

/** Frosts the world: a quarter-size copy, each texel a soft 8×8 average. */
export const FROST_WGSL = /* wgsl */ `
@group(0) @binding(0) var world: texture_2d<f32>;
@group(0) @binding(1) var worldSampler: sampler;

@vertex
fn fullscreen(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(corners[i], 0.0, 1.0);
}

@fragment
fn downsample(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(world));
  let texel = 1.0 / size;
  let uv = position.xy * 4.0 * texel;
  var colour = textureSampleLevel(world, worldSampler, uv, 0.0) * 0.2;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(-1.0, -1.0) * texel, 0.0) * 0.12;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(1.0, -1.0) * texel, 0.0) * 0.12;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(-1.0, 1.0) * texel, 0.0) * 0.12;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(1.0, 1.0) * texel, 0.0) * 0.12;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(-3.0, 0.0) * texel, 0.0) * 0.08;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(3.0, 0.0) * texel, 0.0) * 0.08;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(0.0, -3.0) * texel, 0.0) * 0.08;
  colour += textureSampleLevel(world, worldSampler, uv + vec2f(0.0, 3.0) * texel, 0.0) * 0.08;
  return vec4f(colour.rgb, 1.0);
}
`;

/**
 * Panel: shape (width, height, radius, active), tint (rgb, opacity),
 * light (tile, margin, sway x, halo).
 * Ribbon: lead (leader rgb, first node), follow (follower rgb, node count),
 * flow (+1 toward the far end or -1 back, width, intensity, motion).
 * Light: view (width, height, pixel ratio, seconds), camera (bearing in
 * radians, pitch in degrees, world sampled, unused), world (the world
 * canvas's rectangle), theme (dark, unused…).
 */
export const GLASS_WGSL = /* wgsl */ `${NETWORK}
struct Panel { shape: vec4f, tint: vec4f, light: vec4f, extra: vec4f };
struct Ribbon { lead: vec4f, follow: vec4f, flow: vec4f };
struct Light { view: vec4f, camera: vec4f, world: vec4f, theme: vec4f };

@group(0) @binding(0) var<storage, read> frames: array<Frame>;
@group(0) @binding(1) var<storage, read> state: array<State>;
@group(0) @binding(2) var<storage, read> panels: array<Panel>;
@group(0) @binding(3) var<uniform> light: Light;
@group(0) @binding(4) var frost: texture_2d<f32>;
@group(0) @binding(5) var frostSampler: sampler;
@group(0) @binding(6) var<storage, read> ribbons: array<Ribbon>;

const WARM = vec3f(1.0, 0.74, 0.42);

fn clip(p: vec2f) -> vec4f {
  return vec4f(p.x / light.view.x * 2.0 - 1.0, 1.0 - p.y / light.view.y * 2.0, 0.0, 1.0);
}

fn drawn(node: u32) -> vec2f {
  return frames[node].restLocal.xy + state[node].motion.xy;
}

fn roundedBox(p: vec2f, half: vec2f, radius: f32) -> f32 {
  let q = abs(p) - half + vec2f(radius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn grain(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn frosted(px: vec2f) -> vec3f {
  let uv = (px - light.world.xy) / light.world.zw;
  let texel = 1.0 / vec2f(textureDimensions(frost));
  var colour = textureSampleLevel(frost, frostSampler, uv, 0.0).rgb * 0.32;
  colour += textureSampleLevel(frost, frostSampler, uv + vec2f(2.4, 0.9) * texel, 0.0).rgb * 0.17;
  colour += textureSampleLevel(frost, frostSampler, uv + vec2f(-2.4, -0.9) * texel, 0.0).rgb * 0.17;
  colour += textureSampleLevel(frost, frostSampler, uv + vec2f(-0.9, 2.4) * texel, 0.0).rgb * 0.17;
  colour += textureSampleLevel(frost, frostSampler, uv + vec2f(0.9, -2.4) * texel, 0.0).rgb * 0.17;
  return colour;
}

struct PanelOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) panel: u32,
  @location(2) wobble: vec2f,
};

@vertex
fn panelVertex(@builtin(vertex_index) node: u32) -> PanelOut {
  var out: PanelOut;
  out.position = clip(drawn(node));
  out.local = frames[node].restLocal.zw;
  out.panel = u32(frames[node].identity.x);
  out.wobble = state[node].motion.xy;
  return out;
}

@fragment
fn panelFragment(in: PanelOut) -> @location(0) vec4f {
  let panel = panels[in.panel];
  let size = panel.shape.xy;
  let half = size * 0.5;
  let radius = min(panel.shape.z, min(half.x, half.y));
  let lit = panel.shape.w;
  let tint = panel.tint.rgb;
  let opacity = panel.tint.a;
  let tile = panel.light.x > 0.5;
  let dark = light.theme.x;
  let q = in.local - half;
  let d = roundedBox(q, half, radius);
  let e = 0.75;
  let slope = vec2f(
    roundedBox(q + vec2f(e, 0.0), half, radius) - roundedBox(q - vec2f(e, 0.0), half, radius),
    roundedBox(q + vec2f(0.0, e), half, radius) - roundedBox(q - vec2f(0.0, e), half, radius),
  );
  let normal = slope / max(length(slope), 1e-4);
  let coverage = clamp(0.5 - d, 0.0, 1.0);

  // Outside: the weight under the block and the warm light around its rim.
  var outside = vec4f(0.0);
  if (!tile) {
    let contact = exp(-max(roundedBox(q - vec2f(0.0, 3.0), half, radius), 0.0) / 3.0) * 0.2;
    let ambient = exp(-max(roundedBox(q - vec2f(0.0, 10.0), half, radius), 0.0) / 12.0) * 0.26;
    let shadow = clamp((contact + ambient) * (0.55 + 0.45 * dark), 0.0, 0.62);
    let halo = exp(-max(d, 0.0) / 12.0) * panel.light.w * (0.5 + 0.5 * dark)
      + exp(-max(d, 0.0) / 24.0) * lit * 0.42;
    let glow = mix(WARM, tint, lit * 0.65) * halo * 0.55;
    // Fades out well inside the mesh's margin, so its edge never shows.
    let fade = 1.0 - smoothstep(panel.light.y * 0.4, panel.light.y * 0.92, d);
    outside = vec4f(glow, shadow) * opacity * fade;
  }

  // Inside: the world seen through a lens of frosted glass.
  let px = in.position.xy / light.view.z;
  let inner = clamp(-d / 16.0, 0.0, 1.0);
  let bevel = (1.0 - inner) * (1.0 - inner);
  let bend = -normal * bevel * 26.0 + in.wobble * 1.8;
  let smoke = mix(vec3f(0.95, 0.94, 0.92), vec3f(0.1, 0.105, 0.13), dark);
  var colour = smoke;
  if (light.camera.z > 0.5) {
    let world = frosted(px + bend) * mix(1.04, 1.18, dark);
    colour = mix(world, smoke, mix(0.46, 0.52, dark));
  }
  let down = in.local.y / size.y;
  colour += vec3f(1.0) * (1.0 - smoothstep(0.0, 0.36, down)) * 0.075;
  colour *= 1.0 - smoothstep(0.6, 1.0, down) * 0.2;
  let pool = exp(-pow((1.0 - down) / 0.42, 2.0)) * exp(-pow(q.x / (size.x * 0.6), 2.0));
  colour += tint * pool * select(0.2 + 0.55 * lit, 0.12 + 0.6 * lit, tile);
  let sweep = dot(in.local / size, vec2f(0.82, -0.57)) - panel.light.z * 0.006;
  colour += vec3f(1.0) * (1.0 - smoothstep(0.0, 0.05, abs(fract(sweep * 0.6 + 0.25) - 0.5))) * 0.06;
  colour += (grain(floor(in.position.xy)) - 0.5) * 0.035;

  // The rim catches the key light, which turns with the map.
  let angle = -2.21 - light.camera.x;
  let key = vec2f(cos(angle), sin(angle));
  let facing = max(dot(normal, key), 0.0);
  let line = 1.0 - smoothstep(0.0, 1.6, abs(d + 0.9));
  let rimColour = mix(tint, mix(WARM, vec3f(1.0), facing), 0.55 + 0.45 * facing);
  let rim = line * (0.32 + 0.95 * facing * facing) + exp(min(d, 0.0) / 5.0) * 0.16 * (0.4 + facing);
  colour += rimColour * rim * select(1.0, 0.7, tile);
  colour += vec3f(1.0) * bevel * 0.05;

  let body = select(select(0.9, 0.64, light.camera.z < 0.5), 0.5, tile) * opacity;
  let inside = vec4f(colour * body, body);
  return inside * coverage + outside * (1.0 - coverage);
}

struct RibbonOut {
  @builtin(position) position: vec4f,
  @location(0) across: f32,
  @location(1) along: f32,
  @location(2) @interpolate(flat) ribbon: u32,
};

@vertex
fn ribbonVertex(
  @builtin(vertex_index) vertex: u32,
  @builtin(instance_index) ribbon: u32,
) -> RibbonOut {
  let r = ribbons[ribbon];
  let first = u32(r.lead.w);
  let count = u32(r.follow.w);
  let k = min(vertex / 2u, count - 1u);
  let previous = first + select(k - 1u, 0u, k == 0u);
  let next = first + min(k + 1u, count - 1u);
  let at = drawn(first + k);
  let direction = drawn(next) - drawn(previous);
  let tangent = direction / max(length(direction), 1e-4);
  let side = select(-1.0, 1.0, (vertex & 1u) == 1u);
  let along = f32(k) / f32(count - 1u);
  let width = r.flow.y * (0.4 + 0.6 * sin(along * 3.14159));
  var out: RibbonOut;
  out.position = clip(at + vec2f(-tangent.y, tangent.x) * side * width);
  out.across = side;
  out.along = along;
  out.ribbon = ribbon;
  return out;
}

@fragment
fn ribbonFragment(in: RibbonOut) -> @location(0) vec4f {
  let r = ribbons[in.ribbon];
  let v = in.across;
  let fromLeader = select(1.0 - in.along, in.along, r.flow.x > 0.0);
  let colour = mix(r.lead.rgb, r.follow.rgb, smoothstep(0.15, 0.85, fromLeader));
  let core = exp(-v * v * 16.0);
  let glow = exp(-v * v * 2.4) * 0.4;
  let time = light.view.w * r.flow.w;
  let pulse = pow(0.5 + 0.5 * cos((fromLeader - time * 0.3) * 6.28318 * 2.0), 8.0);
  let ends = smoothstep(0.0, 0.08, in.along) * (1.0 - smoothstep(0.92, 1.0, in.along));
  let intensity = (core * (0.5 + 1.2 * pulse) + glow * (0.45 + 0.7 * pulse)) * ends * r.flow.z;
  return vec4f(colour * intensity, 0.0);
}
`;
