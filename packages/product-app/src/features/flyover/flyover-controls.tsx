// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";

import { useLocalization } from "../../shell/localization";
import "./flyover-controls.css";

/** A sideways swipe at least this long steps xPing a lane aside. */
export const FLYOVER_SWIPE_PIXELS = 36;

export interface FlyoverControlsProps {
  /** Caption from xPing after spotting a high-rarity laser target. */
  readonly lootNotice?: "rare" | "special" | "exclusive" | undefined;
  readonly onSteer: (direction: -1 | 1) => void;
  readonly onCollapse: () => void;
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
  lootNotice,
  onSteer,
  onCollapse,
  onLeave,
  activities,
  force,
}: FlyoverControlsProps) {
  const { t } = useLocalization();
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const noButton = useRef<HTMLButtonElement>(null);
  const yesButton = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    setConfirmCancel(false);
    cancelButton.current?.focus();
  }, []);
  useEffect(() => {
    if (!confirmCancel) return;
    noButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
      } else if (
        event.code === "ArrowLeft" ||
        event.code === "ArrowRight" ||
        event.code === "KeyA" ||
        event.code === "KeyD"
      ) {
        event.stopImmediatePropagation();
      } else if (event.code === "Tab") {
        const first = noButton.current;
        const last = yesButton.current;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [confirmCancel, dismiss]);
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
      <div className="flyover__actions">
        <button
          type="button"
          className="flyover__action flyover__action--collapse"
          onClick={onCollapse}
        >
          {t("flyover.collapse")}
        </button>
        <button
          type="button"
          className="flyover__action flyover__action--cancel"
          ref={cancelButton}
          onClick={() => setConfirmCancel(true)}
        >
          {t("flyover.leave")}
        </button>
      </div>
      {confirmCancel ? (
        <div className="flyover__confirm-backdrop">
          <div
            className="flyover__confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="flyover-confirm-title"
          >
            <p id="flyover-confirm-title" className="flyover__confirm-title">
              {t("flyover.cancelConfirm")}
            </p>
            <div className="flyover__confirm-actions">
              <button
                type="button"
                className="flyover__action"
                ref={noButton}
                onClick={dismiss}
              >
                {t("flyover.no")}
              </button>
              <button
                type="button"
                className="flyover__action"
                ref={yesButton}
                onClick={onLeave}
              >
                {t("flyover.yes")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {lootNotice ? (
        <div className="flyover__loot-notice" role="status" aria-live="polite">
          <strong>xPing</strong>
          <span>{t(`flyover.loot.${lootNotice}`)}</span>
        </div>
      ) : null}
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
  const energyPercent = useSyncExternalStore(
    engine.subscribe,
    () => Math.round(engine.energy() * 100),
    () => Math.round(engine.energy() * 100),
  );
  const percent = Math.min(100, Math.max(0, energyPercent));
  const color = `hsl(${percent / 2} 95% 50%)`;
  return (
    <button
      type="button"
      className="flyover__button flyover__force"
      aria-label={`${t("flyover.force")} (${percent}%)`}
      disabled={!available}
      style={{ "--flyover-energy-color": color } as CSSProperties}
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
      <span className="flyover__force-level">{percent}%</span>
    </button>
  );
}
