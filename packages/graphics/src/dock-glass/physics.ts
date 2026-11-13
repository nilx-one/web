// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The glass and its ribbons are one spring network the GPU steps every frame.
 * Each node is held to a rest position the page lays out (a point of a
 * block, or of a ribbon's curve) by an anchor spring, and to its neighbours
 * by coupling springs. When the page moves a rest position, the node keeps
 * its own velocity for a moment: a block's free edge lags its anchored one,
 * wobbles and settles, and a ribbon sways behind the cards it hangs between.
 *
 * The network is solved in offsets from rest, so only the deformation is
 * simulated. This module is the reference the WGSL kernels mirror; the
 * tests step it on the CPU.
 */

/** Floats per node of state: offset, velocity, rest velocity, last rest. */
export const STATE_FLOATS = 8;
/** Floats per node of frame input: rest, local, springs, identity. */
export const FRAME_FLOATS = 12;
/** Substeps per frame; even, so the result lands back in the first buffer. */
export const SUBSTEPS = 4;
/** A rest jump this far in one frame is a relayout, not a motion. */
export const TELEPORT_PX = 64;

export interface Springs {
  /** Anchor stiffness, per second squared. */
  readonly anchor: number;
  /** Coupling stiffness to each neighbour, per second squared. */
  readonly coupling: number;
  /** Damping, per second. */
  readonly damping: number;
  /** The furthest a node may be pushed off its rest, in CSS pixels. */
  readonly maxOffset: number;
}

/** Below critical damping, so a block overshoots once and settles. */
const PANEL_DAMPING_RATIO = 0.3;
const RIBBON_DAMPING_RATIO = 0.18;

function damped(anchor: number, coupling: number, ratio: number): number {
  return 2 * Math.sqrt(anchor + coupling) * ratio;
}

/**
 * The springs of a block's node. `fromAnchor` is 0 on the edge the block
 * hangs or rests on and 1 on the free edge; `mass` is the block's weight.
 */
export function panelSprings(fromAnchor: number, mass: number): Springs {
  const weight = Math.max(0.2, mass);
  const t = Math.min(1, Math.max(0, fromAnchor));
  const anchor = (560 - 430 * t) / weight;
  const coupling = 240 / weight;
  return {
    anchor,
    coupling,
    damping: damped(anchor, coupling, PANEL_DAMPING_RATIO),
    maxOffset: 3 + 7 * t,
  };
}

/** The springs of a ribbon's node, `along` from 0 at one end to 1 at the other. */
export function ribbonSprings(along: number): Springs {
  const end = Math.min(along, 1 - along) * 2;
  const anchor = end < 0.08 ? 1800 : 26 + 90 * (1 - end);
  const coupling = 900;
  return {
    anchor,
    coupling,
    damping: damped(anchor, coupling, RIBBON_DAMPING_RATIO),
    maxOffset: 28,
  };
}

export interface NetworkFrame {
  /** Rest positions, two floats per node. */
  readonly rest: Float32Array;
  /** Springs, four floats per node: anchor, coupling, damping, max offset. */
  readonly springs: Float32Array;
  /** Neighbours, four per node, `-1` for none. */
  readonly neighbours: Int32Array;
}

/**
 * Takes the frame's rest positions: a node keeps its velocity while its rest
 * moves, so the offset lags. A first frame, or a jump past `TELEPORT_PX`,
 * starts the node at rest instead.
 */
export function advanceNetwork(
  state: Float32Array,
  frame: NetworkFrame,
  dt: number,
  reset: boolean,
): void {
  const count = frame.rest.length / 2;
  for (let node = 0; node < count; node += 1) {
    const s = node * STATE_FLOATS;
    const rx = frame.rest[node * 2]!;
    const ry = frame.rest[node * 2 + 1]!;
    if (reset) {
      state.fill(0, s, s + 6);
    } else {
      const dx = rx - state[s + 6]!;
      const dy = ry - state[s + 7]!;
      if (Math.hypot(dx, dy) > TELEPORT_PX || dt <= 0) {
        state[s + 4] = 0;
        state[s + 5] = 0;
      } else {
        const vx = dx / dt;
        const vy = dy / dt;
        state[s + 2] = state[s + 2]! + state[s + 4]! - vx;
        state[s + 3] = state[s + 3]! + state[s + 5]! - vy;
        state[s + 4] = vx;
        state[s + 5] = vy;
      }
    }
    state[s + 6] = rx;
    state[s + 7] = ry;
  }
}

/** One substep: semi-implicit Euler, reading `source` and writing `target`. */
export function relaxNetwork(
  source: Float32Array,
  target: Float32Array,
  frame: NetworkFrame,
  h: number,
): void {
  const count = frame.rest.length / 2;
  for (let node = 0; node < count; node += 1) {
    const s = node * STATE_FLOATS;
    const ux = source[s]!;
    const uy = source[s + 1]!;
    let lx = 0;
    let ly = 0;
    for (let k = 0; k < 4; k += 1) {
      const other = frame.neighbours[node * 4 + k]!;
      if (other < 0) continue;
      lx += source[other * STATE_FLOATS]! - ux;
      ly += source[other * STATE_FLOATS + 1]! - uy;
    }
    const anchor = frame.springs[node * 4]!;
    const coupling = frame.springs[node * 4 + 1]!;
    const damping = frame.springs[node * 4 + 2]!;
    const maxOffset = frame.springs[node * 4 + 3]!;
    const ax = -anchor * ux + coupling * lx - damping * source[s + 2]!;
    const ay = -anchor * uy + coupling * ly - damping * source[s + 3]!;
    const wx = source[s + 2]! + ax * h;
    const wy = source[s + 3]! + ay * h;
    let nx = ux + wx * h;
    let ny = uy + wy * h;
    const length = Math.hypot(nx, ny);
    if (length > maxOffset) {
      nx *= maxOffset / length;
      ny *= maxOffset / length;
    }
    target.set([nx, ny, wx, wy], s);
    target.set(source.subarray(s + 4, s + 8), s + 4);
  }
}

/** One whole frame on the CPU, as the GPU runs it. */
export function stepNetwork(
  state: Float32Array,
  scratch: Float32Array,
  frame: NetworkFrame,
  dt: number,
  reset = false,
): void {
  advanceNetwork(state, frame, dt, reset);
  const h = Math.min(dt, 1 / 20) / SUBSTEPS;
  for (let step = 0; step < SUBSTEPS; step += 2) {
    relaxNetwork(state, scratch, frame, h);
    relaxNetwork(scratch, state, frame, h);
  }
}
