// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useLocalization } from "../../shell/localization";
import "./flyover-controls.css";

/** A sideways swipe at least this long steps xPing a lane aside. */
export const FLYOVER_SWIPE_PIXELS = 36;

export interface FlyoverControlsProps {
  readonly onSteer: (direction: -1 | 1) => void;
  readonly onLeave: () => void;
  /** The flight's activity row, the lowest element under the steering. */
  readonly activities?: ReactNode;
  /** Push to force: absent, the flight cannot be forced. */
  readonly force?: {
    /** What is left of the engine, from 0 to 1, as it is spent. */
    readonly engine: {
      energy(): number;
      subscribe(listener: () => void): () => void;
    };
    /** Whether forcing is possible now: not on the way back. */
    readonly available: boolean;
    readonly onHold: (holding: boolean) => void;
  };
}

/**
 * At the wheel of the flight: swipe anywhere, or press the buttons, to step
 * xPing left or right, the way a runner game is steered. The map beneath
 * takes no gestures while it flies; the camera is the flight's.
 */
export function FlyoverControls({
  onSteer,
  onLeave,
  activities,
  force,
}: FlyoverControlsProps) {
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
      <div className="flyover__bottom">
        <div className="flyover__steer">
          <button
            type="button"
            className="flyover__button"
            aria-label={t("flyover.left")}
            onClick={() => onSteer(-1)}
          >
            ◀
          </button>
          {force === undefined ? null : <ForceButton {...force} />}
          <button
            type="button"
            className="flyover__button"
            aria-label={t("flyover.right")}
            onClick={() => onSteer(1)}
          >
            ▶
          </button>
        </div>
        {activities === undefined ? null : (
          <div className="flyover__activities">{activities}</div>
        )}
      </div>
    </div>
  );
}

/**
 * Push to force, filled with what is left of the engine. It reads the
 * engine itself, a whole percent at a time, so a held button redraws only
 * itself, not the world around it.
 */
function ForceButton({
  engine,
  available,
  onHold,
}: NonNullable<FlyoverControlsProps["force"]>) {
  const { t } = useLocalization();
  const percent = useSyncExternalStore(
    engine.subscribe,
    () => Math.round(engine.energy() * 100),
    () => Math.round(engine.energy() * 100),
  );
  return (
    <button
      type="button"
      className="flyover__button flyover__force"
      aria-label={t("flyover.force")}
      disabled={!available}
      style={{ "--flyover-energy": `${percent}%` } as CSSProperties}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!event.repeat) onHold(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") onHold(false);
      }}
      onBlur={() => onHold(false)}
    >
      <span aria-hidden="true">⚡</span>
      <span className="flyover__force-level">{percent}%</span>
    </button>
  );
}
