// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useRef } from "react";

import { useLocalization } from "../../shell/localization";
import "./flyover-controls.css";

/** A sideways swipe at least this long steps xPing a lane aside. */
export const FLYOVER_SWIPE_PIXELS = 36;

export interface FlyoverControlsProps {
  readonly onSteer: (direction: -1 | 1) => void;
  readonly onLeave: () => void;
}

/**
 * At the wheel of the flight: swipe anywhere, or press the buttons, to step
 * xPing left or right, the way a runner game is steered. The map beneath
 * takes no gestures while it flies; the camera is the flight's.
 */
export function FlyoverControls({ onSteer, onLeave }: FlyoverControlsProps) {
  const { t } = useLocalization();
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  return (
    <div className="flyover" role="group" aria-label={t("flyover.controls")}>
      <div
        className="flyover__surface"
        aria-hidden="true"
        onPointerDown={(event) => {
          swipe.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerUp={(event) => {
          const from = swipe.current;
          swipe.current = undefined;
          if (from === undefined) return;
          const dx = event.clientX - from.x;
          const dy = event.clientY - from.y;
          if (
            Math.abs(dx) >= FLYOVER_SWIPE_PIXELS &&
            Math.abs(dx) > Math.abs(dy)
          )
            onSteer(dx < 0 ? -1 : 1);
        }}
        onPointerCancel={() => {
          swipe.current = undefined;
        }}
      />
      <button type="button" className="flyover__leave" onClick={onLeave}>
        {t("flyover.leave")}
      </button>
      <div className="flyover__steer">
        <button
          type="button"
          className="flyover__button"
          aria-label={t("flyover.left")}
          onClick={() => onSteer(-1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="flyover__button"
          aria-label={t("flyover.right")}
          onClick={() => onSteer(1)}
        >
          ▶
        </button>
      </div>
    </div>
  );
}
