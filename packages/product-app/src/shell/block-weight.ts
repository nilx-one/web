// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapCamera } from "@nilx-one/map-contract";

import { prefersReducedMotion } from "./motion";

/**
 * Floating blocks carry weight: when the camera moves, each block lags behind
 * the world it floats over, stretches a little in the direction of travel and
 * springs back to rest. This is presentation only. It reads the camera the
 * renderer already reports and decides nothing about the world.
 *
 * The deformation is written as CSS custom properties that feed `transform`,
 * so the compositor draws it whatever backend the world canvas uses.
 */

export interface BlockSway {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** Zoom pressure: positive grows the block, negative squashes it. */
  readonly squash: number;
  readonly vsquash: number;
}

export const BLOCK_REST: BlockSway = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  squash: 0,
  vsquash: 0,
};

/** How far a block may be pushed off its rest, in CSS pixels. */
export const BLOCK_MAX_SWAY = 18;
const MAX_SQUASH = 0.06;
const STIFFNESS = 150;
/** Below critical damping, so a heavy block overshoots once and settles. */
const DAMPING_RATIO = 0.42;
const REST_EPSILON = 0.01;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * One step of a damped spring that pulls the block back to rest. A heavier
 * block takes the same push more slowly and swings longer.
 */
export function stepSway(
  sway: BlockSway,
  push: { readonly x: number; readonly y: number; readonly squash: number },
  mass: number,
  dt: number,
): BlockSway {
  const weight = Math.max(0.2, mass);
  const stiffness = STIFFNESS / weight;
  const damping = 2 * Math.sqrt(stiffness) * DAMPING_RATIO;
  const step = Math.min(Math.max(dt, 0), 1 / 20);

  let vx = sway.vx + push.x / weight;
  let vy = sway.vy + push.y / weight;
  let vsquash = sway.vsquash + push.squash / weight;
  vx += (-stiffness * sway.x - damping * vx) * step;
  vy += (-stiffness * sway.y - damping * vy) * step;
  vsquash += (-stiffness * sway.squash - damping * vsquash) * step;

  return {
    x: clamp(sway.x + vx * step, BLOCK_MAX_SWAY),
    y: clamp(sway.y + vy * step, BLOCK_MAX_SWAY),
    vx,
    vy,
    squash: clamp(sway.squash + vsquash * step, MAX_SQUASH),
    vsquash,
  };
}

export function swaySettled(sway: BlockSway): boolean {
  return (
    Math.abs(sway.x) < REST_EPSILON &&
    Math.abs(sway.y) < REST_EPSILON &&
    Math.abs(sway.vx) < REST_EPSILON &&
    Math.abs(sway.vy) < REST_EPSILON &&
    Math.abs(sway.squash) < REST_EPSILON / 100 &&
    Math.abs(sway.vsquash) < REST_EPSILON / 100
  );
}

const TILE = 512;
/** A brisk pan holds a block about a block-gap off its rest. */
const PUSH_GAIN = 1.4;

function mercatorY(latitude: number): number {
  const sin = Math.sin((Math.max(-85, Math.min(85, latitude)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
}

/**
 * How far the world slid across the screen between two camera readings, in
 * CSS pixels, with how much it zoomed. Blocks are pushed the way the world
 * slid, so they trail it and come back.
 */
export function cameraPush(
  previous: MapCamera,
  next: MapCamera,
): { readonly x: number; readonly y: number; readonly squash: number } {
  const scale = TILE * 2 ** next.zoom;
  let dLongitude = next.center[0] - previous.center[0];
  if (dLongitude > 180) dLongitude -= 360;
  if (dLongitude < -180) dLongitude += 360;
  const worldX = (dLongitude / 360) * scale;
  const worldY =
    (mercatorY(next.center[1]) - mercatorY(previous.center[1])) * scale;
  const bearing = (next.bearing * Math.PI) / 180;
  const screenX = worldX * Math.cos(bearing) + worldY * Math.sin(bearing);
  const screenY = -worldX * Math.sin(bearing) + worldY * Math.cos(bearing);
  let dBearing = next.bearing - previous.bearing;
  if (dBearing > 180) dBearing -= 360;
  if (dBearing < -180) dBearing += 360;
  const dPitch = next.pitch - previous.pitch;
  const finite = (value: number) => (Number.isFinite(value) ? value : 0);
  return {
    x: finite(clamp(-screenX * PUSH_GAIN + dBearing * 4, 240)),
    y: finite(clamp(-screenY * PUSH_GAIN + dPitch * 3, 240)),
    squash: finite(clamp((next.zoom - previous.zoom) * 0.35, 0.5)),
  };
}

export interface BlockWeight {
  /** Starts drawing a block's sway; the return stops it. */
  register(element: HTMLElement, mass: number): () => void;
  /** Pushes every block at once, as one camera step does. */
  push(push: {
    readonly x: number;
    readonly y: number;
    readonly squash: number;
  }): void;
}

interface Tracked {
  readonly element: HTMLElement;
  readonly mass: number;
  sway: BlockSway;
}

function draw(tracked: Tracked): void {
  const { x, y, vx, vy, squash } = tracked.sway;
  const style = tracked.element.style;
  style.setProperty("--block-sway-x", `${x.toFixed(2)}px`);
  style.setProperty("--block-sway-y", `${y.toFixed(2)}px`);
  // A lagging block leans away from the way it is dragged, and leans further
  // while it is still gaining speed.
  style.setProperty(
    "--block-skew-x",
    `${clamp(-x * 0.14 - vx * 0.004, 3.5).toFixed(3)}deg`,
  );
  style.setProperty(
    "--block-skew-y",
    `${clamp(-y * 0.06 - vy * 0.002, 1.5).toFixed(3)}deg`,
  );
  style.setProperty("--block-squash", (1 + squash).toFixed(4));
}

/** One clock for every block on screen. Idle until something pushes. */
export function createBlockWeight(
  scheduler: {
    readonly request: (callback: (now: number) => void) => number;
    readonly cancel: (handle: number) => void;
  } = {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
  },
  reducedMotion: () => boolean = prefersReducedMotion,
): BlockWeight {
  const blocks = new Set<Tracked>();
  const pending = { x: 0, y: 0, squash: 0 };
  let frame: number | undefined;
  let last: number | undefined;

  const tick = (now: number) => {
    frame = undefined;
    const dt = last === undefined ? 1 / 60 : (now - last) / 1000;
    last = now;
    const push = { ...pending };
    pending.x = 0;
    pending.y = 0;
    pending.squash = 0;
    let moving = false;
    for (const block of blocks) {
      block.sway = stepSway(block.sway, push, block.mass, dt);
      if (swaySettled(block.sway)) block.sway = BLOCK_REST;
      else moving = true;
      draw(block);
    }
    if (moving) frame = scheduler.request(tick);
    else last = undefined;
  };

  const wake = () => {
    if (frame === undefined) frame = scheduler.request(tick);
  };

  return {
    register(element, mass) {
      const block: Tracked = { element, mass, sway: BLOCK_REST };
      blocks.add(block);
      return () => {
        blocks.delete(block);
        if (blocks.size === 0 && frame !== undefined) {
          scheduler.cancel(frame);
          frame = undefined;
          last = undefined;
        }
      };
    },
    push(push) {
      if (blocks.size === 0 || reducedMotion()) return;
      pending.x += push.x;
      pending.y += push.y;
      pending.squash += push.squash;
      wake();
    },
  };
}
