// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import "./dock-window.css";

/**
 * The Dock is one window onto a small navigation stack.
 *
 * A screen change is a from-to pair rather than a replacement: the screen being
 * left and the screen being entered are both on the surface for the length of
 * the move, and the window itself travels between their two heights. Forward
 * arrives from the trailing edge while the previous screen recedes; back is
 * exactly that reversed — the idiom iOS made familiar, so a person already
 * knows which direction they are going before reading anything.
 *
 * Depth is what tells the two apart. Presentation never infers direction from
 * which screen is named; it is told.
 */

export type DockNavigation = "push" | "pop";

export interface DockWindowProps {
  /** Which screen the window is presenting. A change is a navigation. */
  readonly screen: string;
  /** How deep that screen sits. Deeper is forward, shallower is back. */
  readonly depth: number;
  readonly children: ReactNode;
}

interface DockScreen {
  readonly screen: string;
  readonly depth: number;
  readonly content: ReactNode;
}

interface DockTransition {
  readonly navigation: DockNavigation;
  readonly from: ReactNode;
  readonly pair: string;
}

/** Long enough to read as travel, short enough to stay out of the way. */
export const DOCK_WINDOW_TRANSITION_MS = 420;

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function DockWindow({ screen, depth, children }: DockWindowProps) {
  const [settled, setSettled] = useState<DockScreen>({
    screen,
    depth,
    content: children,
  });
  const [transition, setTransition] = useState<DockTransition | undefined>(
    undefined,
  );
  const windowRef = useRef<HTMLDivElement | null>(null);
  const enteringRef = useRef<HTMLDivElement | null>(null);
  const settledHeight = useRef(0);

  if (settled.screen !== screen) {
    // The screen the window still shows becomes the outgoing half of the pair,
    // held as it was rather than re-derived from the props that replaced it.
    setTransition({
      navigation: depth < settled.depth ? "pop" : "push",
      from: settled.content,
      pair: `${settled.screen}:${screen}`,
    });
    setSettled({ screen, depth, content: children });
  }

  useLayoutEffect(() => {
    const element = windowRef.current;
    if (element === null) return;

    if (transition === undefined) {
      element.style.height = "";
      settledHeight.current = element.offsetHeight;
      return;
    }

    // A move that interrupts another starts from wherever the window is now.
    const from =
      element.style.height === ""
        ? settledHeight.current
        : element.getBoundingClientRect().height;
    const to = enteringRef.current?.offsetHeight ?? 0;

    // A window with no measurable layout has no two heights to travel between,
    // and a person who asked for less motion is not asking for this one. Both
    // arrive settled, before the browser has painted the pair.
    if (from === 0 || to === 0 || prefersReducedMotion()) {
      setTransition(undefined);
      return;
    }

    element.style.height = `${from}px`;
    // Reading the box back commits that height, so the browser animates from it
    // instead of jumping straight to the height that replaces it.
    void element.offsetHeight;
    element.style.height = `${to}px`;
  }, [transition]);

  useEffect(() => {
    if (transition === undefined) return;
    const timer = window.setTimeout(
      () => setTransition(undefined),
      DOCK_WINDOW_TRANSITION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [transition]);

  return (
    <div
      className="bond-dock__window"
      ref={windowRef}
      {...(transition === undefined
        ? {}
        : { "data-navigation": transition.navigation })}
    >
      {transition === undefined ? null : (
        <div
          className="bond-dock__screen"
          data-phase="from"
          key={`from:${transition.pair}`}
          aria-hidden="true"
          inert
        >
          {transition.from}
        </div>
      )}
      <div
        className="bond-dock__screen"
        data-phase={transition === undefined ? "settled" : "to"}
        key={screen}
        ref={enteringRef}
      >
        {children}
      </div>
    </div>
  );
}
