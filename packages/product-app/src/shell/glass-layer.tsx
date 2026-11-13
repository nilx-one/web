// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useLayoutEffect, useRef } from "react";

import {
  boxQuad,
  composeBoxMatrix,
  createDockGlass,
  ribbonCurves,
  type DockGlass,
  type GlassPanel,
  type GlassRibbon,
  type GlassScene,
  type Rgb,
} from "@nilx-one/graphics";
import type { MapRenderer } from "@nilx-one/map-contract";

import type { BlockWeight } from "./block-weight";
import { prefersReducedMotion } from "./motion";

export type GlassSeat = "avaia" | "bond";

const SEAT_TINT: Record<GlassSeat, Rgb> = {
  avaia: [0.61, 0.42, 0.98],
  bond: [0.22, 0.84, 0.9],
};
const WARM: Rgb = [1, 0.72, 0.4];

function isSeat(value: string | undefined): value is GlassSeat {
  return value === "avaia" || value === "bond";
}

/** `rgb(…)` or `rgba(…)` as 0–1 channels; anything else is the warm key light. */
export function parseTint(value: string): Rgb {
  const match = /rgba?\(([^)]*)\)/.exec(value);
  if (match === null) return WARM;
  const [red, green, blue] = match[1]!
    .split(/[\s,/]+/)
    .map((part) => Number.parseFloat(part) / 255);
  return [red, green, blue].every((channel) => Number.isFinite(channel))
    ? [red!, green!, blue!]
    : WARM;
}

/** Where the page drew a block this frame, and what its glass is made of. */
export function readGlassPanel(
  element: HTMLElement,
  mass: number,
  swayX: number,
  tile: boolean,
): GlassPanel | undefined {
  const bounds = element.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  if (width === 0 || height === 0 || bounds.width === 0) return undefined;
  const style = getComputedStyle(element);
  const seat = element.dataset.seat;
  const active =
    element.hasAttribute("data-glass-lit") ||
    element.querySelector(".bond-dock__bond--active") !== null;
  const opacity = Number.parseFloat(style.opacity);
  return {
    quad: boxQuad(bounds, width, height, composeBoxMatrix(style)),
    width,
    height,
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
    tint: isSeat(seat)
      ? SEAT_TINT[seat]
      : parseTint(style.getPropertyValue("--glass-tint")),
    active: active ? 1 : 0,
    opacity: Number.isFinite(opacity) ? opacity : 1,
    mass,
    anchor: element.closest(".app-shell__bottom") === null ? "top" : "bottom",
    tile,
    halo: tile ? 0 : isSeat(seat) ? 1 : 0.6,
    swayX,
  };
}

/**
 * The ribbons between the Avaia's card and the Bond's, flowing from whoever
 * drives to whoever follows: in the leader's colour where they start and the
 * follower's where they arrive.
 */
export function pairRibbons(
  avaia: GlassPanel,
  bond: GlassPanel,
  leader: GlassSeat,
): GlassRibbon[] {
  const [under, over] = ribbonCurves(avaia.quad, bond.quad);
  const follower: GlassSeat = leader === "avaia" ? "bond" : "avaia";
  const flow = leader === "avaia" ? 1 : -1;
  return [
    {
      curve: under,
      leader: SEAT_TINT[leader],
      follower: SEAT_TINT[follower],
      flow,
      width: 7,
      intensity: 1,
    },
    {
      curve: over,
      leader: WARM,
      follower: SEAT_TINT[follower],
      flow,
      width: 5,
      intensity: 0.8,
    },
  ];
}

function readScene(
  weight: BlockWeight,
  renderer: Pick<MapRenderer, "getCamera">,
  leader: GlassSeat,
  shell: HTMLElement | null,
  time: number,
  dt: number,
): GlassScene {
  const blocks: GlassPanel[] = [];
  const tiles: GlassPanel[] = [];
  const seats = new Map<GlassSeat, GlassPanel>();
  for (const block of weight.blocks()) {
    const panel = readGlassPanel(
      block.element,
      block.mass,
      block.sway.x,
      false,
    );
    if (panel === undefined) continue;
    blocks.push(panel);
    const seat = block.element.dataset.seat;
    if (isSeat(seat)) seats.set(seat, panel);
    for (const element of block.element.querySelectorAll<HTMLElement>(
      "[data-glass-tile]",
    )) {
      const tile = readGlassPanel(element, block.mass, block.sway.x, true);
      if (tile !== undefined)
        tiles.push({ ...tile, opacity: tile.opacity * panel.opacity });
    }
  }
  const avaia = seats.get("avaia");
  const bond = seats.get("bond");
  const camera = renderer.getCamera();
  return {
    panels: [...blocks, ...tiles],
    ribbons:
      avaia === undefined || bond === undefined
        ? []
        : pairRibbons(avaia, bond, leader),
    bearing: camera.bearing,
    pitch: camera.pitch,
    dark: shell?.dataset.theme === "dark",
    motion: !prefersReducedMotion(),
    time,
    dt,
  };
}

export interface GlassLayerProps {
  readonly weight: BlockWeight;
  readonly renderer: Pick<MapRenderer, "getCamera" | "subscribeFrame">;
  /** Who drives: the ribbons flow from that seat to the other. */
  readonly leader: GlassSeat;
}

/**
 * Draws every weighted block's glass on the GPU: the world refracted through
 * it, its rim, halo and weight, and the ribbons between the seats. A spring
 * network on the GPU deforms the glass around each block's motion. Where
 * WebGPU is missing, nothing is drawn and the blocks keep their CSS glass.
 */
export function GlassLayer({ weight, renderer, leader }: GlassLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const leaderRef = useRef(leader);

  useLayoutEffect(() => {
    leaderRef.current = leader;
  }, [leader]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || globalThis.navigator?.gpu === undefined) return;
    const shell = canvas.closest<HTMLElement>(".app-shell");
    let glass: DockGlass | undefined;
    let frame: number | undefined;
    let last: number | undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      glass?.dispose();
      glass = undefined;
      if (shell !== null) delete shell.dataset.glass;
    };
    const tick = (now: number) => {
      frame = undefined;
      if (glass === undefined) return;
      const dt = last === undefined ? 1 / 60 : (now - last) / 1000;
      last = now;
      glass.draw(
        readScene(weight, renderer, leaderRef.current, shell, now / 1000, dt),
      );
      frame = window.requestAnimationFrame(tick);
    };
    createDockGlass(canvas, stop).then(
      (created) => {
        if (stopped) {
          created.dispose();
          return;
        }
        glass = created;
        if (shell !== null) shell.dataset.glass = "gpu";
        frame = window.requestAnimationFrame(tick);
      },
      () => {
        stopped = true;
      },
    );
    const unsubscribe = renderer.subscribeFrame?.((world) => {
      glass?.world(world, world.getBoundingClientRect());
    });
    return () => {
      unsubscribe?.();
      stop();
    };
  }, [renderer, weight]);

  return <canvas ref={canvasRef} className="glass-layer" aria-hidden="true" />;
}
