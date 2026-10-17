// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { useLocalization } from "../../shell/localization";
import { CAMERA_MODES, type CameraFollow } from "./follow-camera";

export const CAMERA_MODE_IDLE_MS = 3_000;

export interface CameraModeControlProps {
  readonly renderer: MapRenderer;
  readonly mode: CameraFollow;
  /** Modes the identity at the wheel offers; the others show unavailable. */
  readonly available?: readonly CameraFollow[];
  readonly onFollow: () => void;
  readonly onIsometric: () => void;
  readonly onFree: () => void;
}

/** A compact mode chip during map interaction; open it to choose or cycle. */
export function CameraModeControl({
  renderer,
  mode,
  available = CAMERA_MODES,
  onFollow,
  onIsometric,
  onFree,
}: CameraModeControlProps) {
  const { t } = useLocalization();
  const root = useRef<HTMLDivElement>(null);
  const idle = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(
    undefined,
  );
  const [view, setView] = useState({ mode, expanded: true });
  // A new mode announces itself, including Free entered by a touch pinch.
  // Keep the same DOM buttons and focus when controlled mode changes.
  if (view.mode !== mode) setView({ mode, expanded: true });
  const expanded = view.mode !== mode || view.expanded;

  const clearIdle = useCallback(() => {
    if (idle.current !== undefined) globalThis.clearTimeout(idle.current);
    idle.current = undefined;
  }, []);

  const collapse = useCallback(() => {
    const active = document.activeElement;
    const selected = root.current?.querySelector<HTMLButtonElement>(
      "[aria-pressed='true']",
    );
    if (
      active !== selected &&
      active !== null &&
      root.current?.contains(active)
    ) {
      selected?.focus({ preventScroll: true });
    }
    // Focusing the remaining chip may itself restart the timer.
    clearIdle();
    setView({ mode, expanded: false });
  }, [clearIdle, mode]);

  const armIdle = useCallback(() => {
    clearIdle();
    idle.current = globalThis.setTimeout(collapse, CAMERA_MODE_IDLE_MS);
  }, [clearIdle, collapse]);

  const expand = useCallback(() => {
    setView({ mode, expanded: true });
    armIdle();
  }, [armIdle, mode]);

  // Expanding or collapsing travels from the old width to the new one, the
  // way the Dock window travels between screen heights.
  const width = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const panel = root.current;
    if (panel === null) return;
    const from = width.current;
    // Mark the move before measuring, so the highlight lands with its chip.
    panel.dataset.resizing = "";
    panel.style.width = "";
    const to = panel.getBoundingClientRect().width;
    width.current = to;
    const settle = () => {
      panel.style.width = "";
      delete panel.dataset.resizing;
    };
    if (
      from === undefined ||
      from === to ||
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      settle();
      return;
    }
    panel.style.width = `${from}px`;
    void panel.getBoundingClientRect();
    panel.style.width = `${to}px`;
    const end = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === "width") settle();
    };
    panel.addEventListener("transitionend", end);
    panel.addEventListener("transitioncancel", end);
    return () => {
      panel.removeEventListener("transitionend", end);
      panel.removeEventListener("transitioncancel", end);
      settle();
    };
  }, [expanded]);

  useEffect(() => {
    armIdle();
    const camera = renderer.subscribeCamera((change) => {
      // Automatic tracking, opening flights and cutscene moves are not input.
      if (change.gesture) collapse();
    });
    const ground = renderer.subscribeGroundTap?.(() => collapse());
    return () => {
      clearIdle();
      camera();
      ground?.();
    };
  }, [armIdle, clearIdle, collapse, renderer]);

  const buttons = [
    { mode: "locked", label: t("camera.follow"), select: onFollow },
    { mode: "isometric", label: t("camera.isometric"), select: onIsometric },
    { mode: "free", label: t("camera.free"), select: onFree },
  ] as const;

  return (
    <div
      ref={root}
      className="camera-mode-control"
      role="group"
      aria-label={t("camera.mode")}
      data-expanded={expanded}
      style={
        {
          "--camera-mode-slots": expanded ? buttons.length : 1,
          "--camera-mode-index": expanded
            ? buttons.findIndex((button) => button.mode === mode)
            : 0,
        } as CSSProperties
      }
      onPointerDown={armIdle}
      onKeyDown={armIdle}
      onFocus={armIdle}
      onClick={(event) => {
        if (!expanded && event.target === event.currentTarget) expand();
      }}
    >
      <span className="camera-mode-control__thumb" aria-hidden="true" />
      {buttons.map((button) => (
        <button
          key={button.mode}
          type="button"
          className="camera-mode-control__button"
          hidden={!expanded && button.mode !== mode}
          aria-pressed={button.mode === mode}
          disabled={!available.includes(button.mode)}
          aria-expanded={button.mode === mode ? expanded : undefined}
          onClick={() => {
            // Opening the chip never changes mode or consumes a distance step.
            if (!expanded) {
              expand();
              return;
            }
            button.select();
            armIdle();
          }}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
