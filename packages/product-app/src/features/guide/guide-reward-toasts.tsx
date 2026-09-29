// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { GuideXpSubject } from "./guide-confetti";

/** How long a chip takes to fly from the scene to its corner. */
export const GUIDE_TOAST_FLIGHT_MS = 720;
/** Once in the corner the top chip lives 3 s, and each below it half a second longer. */
export const GUIDE_TOAST_LIFE_MS = 3_000;
export const GUIDE_TOAST_LIFE_STEP_MS = 500;
/** How long a chip takes to fade once its life is over. */
export const GUIDE_TOAST_FADE_MS = 320;

/** The same curve the Dock moves its screens with. */
const FLIGHT_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

export interface GuideRewardToast {
  readonly key: string;
  readonly subject: GuideXpSubject;
  readonly kind: "xp" | "level";
  readonly text: string;
  /** Its place in the stack, top first: it decides how long it lives. */
  readonly index: number;
  /** Where it was on screen when it left the scene, if it was shown there. */
  readonly from?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

export function guideToastLifeMs(index: number): number {
  return GUIDE_TOAST_LIFE_MS + GUIDE_TOAST_LIFE_STEP_MS * index;
}

interface ToastProps {
  readonly toast: GuideRewardToast;
  readonly reducedMotion: boolean;
  onExpire(key: string): void;
}

function Toast({ toast, reducedMotion, onExpire }: ToastProps) {
  const ref = useRef<HTMLLIElement>(null);
  const [fading, setFading] = useState(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  // First, last, invert, play: it is laid out in the corner and flown there
  // from wherever the scene showed it.
  useLayoutEffect(() => {
    const element = ref.current;
    const from = toast.from;
    if (
      element === null ||
      reducedMotion ||
      typeof element.animate !== "function"
    ) {
      return;
    }
    const to = element.getBoundingClientRect();
    const start =
      from === undefined
        ? {
            x: globalThis.innerWidth / 2 - to.left - to.width / 2,
            y: globalThis.innerHeight / 2 - to.top - to.height / 2,
          }
        : {
            x: from.left + from.width / 2 - (to.left + to.width / 2),
            y: from.top + from.height / 2 - (to.top + to.height / 2),
          };
    element.animate(
      [
        {
          transform: `translate(${String(start.x)}px, ${String(start.y)}px)`,
          opacity: from === undefined ? 0 : 1,
        },
        { transform: "translate(0, 0)", opacity: 1 },
      ],
      { duration: GUIDE_TOAST_FLIGHT_MS, easing: FLIGHT_EASE, fill: "both" },
    );
  }, [reducedMotion, toast.from]);

  useEffect(() => {
    const flight = reducedMotion ? 0 : GUIDE_TOAST_FLIGHT_MS;
    const lived = flight + guideToastLifeMs(toast.index);
    const fade = globalThis.setTimeout(() => setFading(true), lived);
    const gone = globalThis.setTimeout(
      () => onExpireRef.current(toast.key),
      lived + (reducedMotion ? 0 : GUIDE_TOAST_FADE_MS),
    );
    return () => {
      globalThis.clearTimeout(fade);
      globalThis.clearTimeout(gone);
    };
  }, [reducedMotion, toast.index, toast.key]);

  return (
    <li
      ref={ref}
      className="guide-toast guide-xp"
      data-subject={toast.subject}
      data-kind={toast.kind}
      data-fading={fading ? "true" : undefined}
    >
      <span className="guide-xp__chip">{toast.text}</span>
    </li>
  );
}

export interface GuideRewardToastsProps {
  readonly toasts: readonly GuideRewardToast[];
  readonly reducedMotion: boolean;
  onExpire(key: string): void;
}

/**
 * What a scene paid, once she has said it: the chips leave the scene for the
 * corner the Dock stands in and stay there a moment — the top one 3 s, each
 * below it half a second longer — then go. The scene already read them out;
 * this is only for the eye.
 */
export function GuideRewardToasts({
  toasts,
  reducedMotion,
  onExpire,
}: GuideRewardToastsProps) {
  if (toasts.length === 0) return null;
  return (
    <ol className="guide-reward-toasts" aria-hidden="true">
      {toasts.map((toast) => (
        <Toast
          key={toast.key}
          toast={toast}
          reducedMotion={reducedMotion}
          onExpire={onExpire}
        />
      ))}
    </ol>
  );
}
