// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import type { MapRenderer } from "@nilx-one/map-contract";

import {
  cameraPush,
  createBlockWeight,
  type BlockWeight,
} from "./block-weight";
import { prefersReducedMotion } from "./motion";
import "./weighted-block.css";

/** How long a block takes to leave before it is gone from the page. */
export const BLOCK_EXIT_MS = 280;

const BlockWeightContext = createContext<BlockWeight | undefined>(undefined);

/** One clock for every block a surface floats, alive as long as it is. */
export function useBlockWeightClock(): BlockWeight {
  return useMemo(() => createBlockWeight(), []);
}

/** Gives every `WeightedBlock` below it the surface's shared clock. */
export function BlockWeightProvider({
  weight,
  children,
}: {
  readonly weight: BlockWeight;
  readonly children: ReactNode;
}) {
  return (
    <BlockWeightContext.Provider value={weight}>
      {children}
    </BlockWeightContext.Provider>
  );
}

export function useBlockWeight(): BlockWeight | undefined {
  return useContext(BlockWeightContext);
}

/**
 * Feeds camera travel to the blocks. The renderer reports when a move starts
 * and ends; between the two the camera is read once a frame, so every block
 * feels the whole move and not only its end points.
 */
export function useCameraWeight(
  renderer: Pick<MapRenderer, "getCamera" | "subscribeCamera">,
  weight: BlockWeight | undefined,
): void {
  useEffect(() => {
    if (weight === undefined) return;
    let previous = renderer.getCamera();
    let frame: number | undefined;
    let moving = false;
    let restFrames = 0;
    const sample = () => {
      frame = undefined;
      const next = renderer.getCamera();
      const push = cameraPush(previous, next);
      previous = next;
      const still = push.x === 0 && push.y === 0 && push.squash === 0;
      if (!still) weight.push(push);
      restFrames = still ? restFrames + 1 : 0;
      if (moving || restFrames < 2)
        frame = window.requestAnimationFrame(sample);
    };
    const unsubscribe = renderer.subscribeCamera((change) => {
      moving = change.phase === "start";
      restFrames = 0;
      if (frame === undefined) frame = window.requestAnimationFrame(sample);
    });
    return () => {
      unsubscribe();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [renderer, weight]);
}

type PresencePhase = "present" | "exiting";

/**
 * Keeps something on the page for its leaving animation after it was asked
 * to go, so nothing simply blinks out. While it leaves it is inert and hidden
 * from assistive technology: it is already gone for anyone using it.
 */
export function usePresence(show: boolean): {
  readonly rendered: boolean;
  readonly phase: PresencePhase;
} {
  const [rendered, setRendered] = useState(show);
  if (show && !rendered) setRendered(true);

  useEffect(() => {
    if (show || !rendered) return;
    const timer = window.setTimeout(
      () => setRendered(false),
      prefersReducedMotion() ? 0 : BLOCK_EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [rendered, show]);

  return { rendered: show || rendered, phase: show ? "present" : "exiting" };
}

export interface WeightedBlockProps extends HTMLAttributes<HTMLElement> {
  readonly as?: "div" | "section" | "nav";
  /** Heavier blocks lag further and swing longer. One is a dock card. */
  readonly mass?: number;
  /** A block asked to go leaves with an animation first. */
  readonly show?: boolean;
  readonly children?: ReactNode;
}

/**
 * A floating glass block with weight. It arrives with a drop and a settle,
 * leaves with a lift and a fade, and while the camera moves it trails the
 * world and springs back.
 */
export function WeightedBlock({
  as: Element = "div",
  mass = 1,
  show = true,
  className,
  children,
  ...rest
}: WeightedBlockProps) {
  const weight = useBlockWeight();
  const ref = useRef<HTMLElement | null>(null);
  const { rendered, phase } = usePresence(show);

  useLayoutEffect(() => {
    const element = ref.current;
    if (weight === undefined || element === null) return;
    return weight.register(element, mass);
  }, [mass, rendered, weight]);

  if (!rendered) return null;
  return (
    <Element
      {...rest}
      ref={(element: HTMLElement | null) => {
        ref.current = element;
      }}
      className={
        className === undefined
          ? "weighted-block"
          : `weighted-block ${className}`
      }
      data-presence={phase}
      {...(phase === "exiting"
        ? { "aria-hidden": true as const, inert: true }
        : {})}
    >
      <span className="weighted-block__glass" aria-hidden="true" />
      {children}
    </Element>
  );
}
