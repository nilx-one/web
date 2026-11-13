// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "../../shell/motion";
import { BLOCK_EXIT_MS, WeightedBlock } from "../../shell/weighted-block";

import "./dock-path.css";

export type DockPathIcon =
  | "dock"
  | "identity"
  | "settings"
  | "edit"
  | "inventory"
  | "avaia"
  | "avatar"
  | "providers"
  | "bond";

export interface DockPathStep {
  /** Stable for as long as the window it names is open. */
  readonly id: string;
  readonly label: string;
  readonly icon: DockPathIcon;
}

function PathIcon({ icon }: { readonly icon: DockPathIcon }) {
  const paths: Record<DockPathIcon, string> = {
    dock: "M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z",
    identity:
      "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 8c.6-3.4 3.4-5.5 7-5.5s6.4 2.1 7 5.5",
    settings:
      "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm7.4-2.2.1-1-.1-1 2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6-.1 1 .1 1-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4z",
    edit: "M4 20h4L19 9l-4-4L4 16zm9-13 4 4",
    inventory: "M5 8h14l-1 12H6zm4 0a3 3 0 0 1 6 0",
    avaia:
      "M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M18 6l-2.5 2.5m-7 7L6 18",
    avatar: "M12 3 20 7.5v9L12 21l-8-4.5v-9zm0 0v18M4 7.5l8 4.5 8-4.5",
    providers:
      "M9 15l6-6M8 11l-2 2a3 3 0 0 0 4.2 4.2l2-2m3.8-2.4 2-2A3 3 0 0 0 13.8 6.6l-2 2",
    bond: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  };
  return (
    <svg className="dock-path__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[icon]} />
    </svg>
  );
}

function trailKey(steps: readonly DockPathStep[]): string {
  return steps.map((step) => step.id).join("/");
}

/** The windows a change of path closes: the old path past what both share. */
function closedSteps(
  before: readonly DockPathStep[],
  after: readonly DockPathStep[],
): DockPathStep[] {
  let shared = 0;
  while (
    shared < before.length &&
    shared < after.length &&
    before[shared]!.id === after[shared]!.id
  ) {
    shared += 1;
  }
  return before.slice(shared);
}

export interface DockPathProps {
  /** From the Dock itself to the window that is open. Never empty. */
  readonly steps: readonly [DockPathStep, ...DockPathStep[]];
  /** What the open window is about, in a line. */
  readonly info: string;
  /** One fact beside it, such as a level. */
  readonly fact?: string;
  readonly label: string;
  /** How the step before the open window reads as a way back to it. */
  readonly backLabel: (place: string) => string;
  readonly onBack: () => void;
}

/**
 * Where the Dock is, in the bottom-left corner: a glass block that grows out
 * of the corner and always shows at least the Dock itself. Each window that
 * opens adds a step and each one that closes leaves with an animation, a lit
 * pill slides from the window that was open to the one that is, and the
 * line beside it says what that window is about.
 */
export function DockPath({
  steps,
  info,
  fact,
  label,
  backLabel,
  onBack,
}: DockPathProps) {
  const key = trailKey(steps);
  const [trail, setTrail] = useState<{
    readonly key: string;
    readonly steps: readonly DockPathStep[];
    readonly closing: readonly DockPathStep[];
    /** How many steps the path kept through its last change. */
    readonly kept: number;
  }>({ key, steps, closing: [], kept: steps.length });
  if (trail.key !== key) {
    const closed = closedSteps(trail.steps, steps);
    setTrail({
      key,
      steps,
      closing: closed,
      kept: trail.steps.length - closed.length,
    });
  }
  const closing = trail.closing;

  useEffect(() => {
    if (closing.length === 0) return;
    const timer = window.setTimeout(
      () =>
        setTrail((current) => ({
          ...current,
          closing: [],
          kept: current.steps.length,
        })),
      prefersReducedMotion() ? 0 : BLOCK_EXIT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [closing]);

  const listRef = useRef<HTMLOListElement | null>(null);
  const thumbRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const thumb = thumbRef.current;
    if (list === null || thumb === null) return;
    const current = list.querySelector<HTMLElement>(
      '[aria-current="page"] .dock-path__place',
    );
    if (current === null) return;
    const place = () => {
      // Steps are positioned for their open and close motion, so the place's
      // own offsetLeft is relative to its step, not to the thumb's frame.
      let x = 0;
      for (
        let node: HTMLElement | null = current;
        node !== null && node !== thumb.offsetParent;
        node = node.offsetParent as HTMLElement | null
      ) {
        x += node.offsetLeft;
      }
      thumb.style.setProperty("--path-thumb-x", `${x}px`);
      thumb.style.setProperty("--path-thumb-width", `${current.offsetWidth}px`);
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(current);
    observer.observe(list);
    return () => observer.disconnect();
  }, [key]);

  const kept = steps.slice(0, trail.kept);
  const opened = steps.slice(trail.kept);
  const items = [
    ...kept.map((step) => ({ step, phase: "present" as const })),
    ...closing.map((step) => ({ step, phase: "exiting" as const })),
    ...opened.map((step) => ({ step, phase: "present" as const })),
  ];
  const last = steps.at(-1)!;
  const parent = steps.length > 1 ? steps.at(-2) : undefined;

  return (
    <WeightedBlock
      as="nav"
      className="dock-path"
      mass={0.9}
      aria-label={label}
      data-depth={steps.length}
    >
      <span
        ref={thumbRef}
        className="dock-path__thumb"
        data-glass-tile=""
        data-glass-lit=""
        aria-hidden="true"
      />
      <ol ref={listRef} className="dock-path__steps">
        {items.map(({ step, phase }, index) => {
          const current = phase === "present" && step.id === last.id;
          const content = (
            <>
              <PathIcon icon={step.icon} />
              <span className="dock-path__label">{step.label}</span>
            </>
          );
          return (
            <li
              key={`${phase}:${step.id}`}
              className="dock-path__step"
              data-presence={phase}
              {...(current ? { "aria-current": "page" as const } : {})}
              {...(phase === "exiting"
                ? { "aria-hidden": true as const, inert: true }
                : {})}
            >
              {index > 0 ? (
                <span className="dock-path__separator" aria-hidden="true">
                  ›
                </span>
              ) : null}
              {phase === "present" && step.id === parent?.id ? (
                <button
                  type="button"
                  className="dock-path__place"
                  aria-label={backLabel(step.label)}
                  onClick={onBack}
                >
                  {content}
                </button>
              ) : (
                <span className="dock-path__place">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="dock-path__info" key={`${key}:${info}`}>
        <span>{info}</span>
        {fact === undefined ? null : (
          <span className="dock-path__fact">{fact}</span>
        )}
      </p>
    </WeightedBlock>
  );
}
