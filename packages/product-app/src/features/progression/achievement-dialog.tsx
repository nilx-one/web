// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useId, useRef } from "react";

import { useLocalization, type TranslationKey } from "../../shell/localization";
import "./achievement-dialog.css";
import {
  ACHIEVEMENTS,
  type AchievementId,
  type ProgressionStanding,
} from "./progression";

const TITLE_KEYS: Readonly<Record<AchievementId, TranslationKey>> = {
  "avaia-configured": "achievement.avaiaConfigured",
  "avaia-model-downloaded": "achievement.avaiaModelDownloaded",
};

export interface AchievementDialogState {
  readonly achievement: AchievementId;
  /** Standing just before the achievement paid, to say which levels it crossed. */
  readonly before: ProgressionStanding;
  readonly after: ProgressionStanding;
  /** A next step worth naming, when there is one this client can offer. */
  readonly next?: "download";
}

export interface AchievementDialogProps {
  readonly state: AchievementDialogState;
  readonly bondName: string;
  readonly avaiaName: string;
  onClose(): void;
}

/**
 * What an achievement paid, said once and closed by the person who read it.
 * It floats over the world rather than replacing any screen: the world stays
 * mounted underneath, and closing it leaves everything where it was.
 */
export function AchievementDialog({
  state,
  bondName,
  avaiaName,
  onClose,
}: AchievementDialogProps) {
  const { t } = useLocalization();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const achievement = ACHIEVEMENTS[state.achievement];

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const levels = [
    state.after.bond.level > state.before.bond.level
      ? { name: bondName, level: state.after.bond.level }
      : undefined,
    state.after.avaia.level > state.before.avaia.level
      ? { name: avaiaName, level: state.after.avaia.level }
      : undefined,
  ].filter((entry) => entry !== undefined);

  return (
    <div className="achievement-dialog">
      <section
        className="achievement-dialog__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="achievement-dialog__title" id={titleId}>
          {t(TITLE_KEYS[state.achievement])}
        </h2>
        <ul className="achievement-dialog__rewards">
          {achievement.bondXp > 0 ? (
            <li>
              {t("achievement.bondXp").replace(
                "{xp}",
                String(achievement.bondXp),
              )}
            </li>
          ) : null}
          {achievement.avaiaXp > 0 ? (
            <li>
              {t("achievement.avaiaXp").replace(
                "{xp}",
                String(achievement.avaiaXp),
              )}
            </li>
          ) : null}
          {levels.map((entry) => (
            <li key={entry.name} className="achievement-dialog__level">
              {t("achievement.level")
                .replace("{name}", entry.name)
                .replace("{level}", String(entry.level))}
            </li>
          ))}
        </ul>
        {state.next === "download" ? (
          <p className="achievement-dialog__next">
            <i className="attention-dot" aria-hidden="true" />
            {t("achievement.nextDownload")}
          </p>
        ) : null}
        <button
          ref={closeRef}
          className="achievement-dialog__close"
          type="button"
          onClick={onClose}
        >
          {t("achievement.continue")}
        </button>
      </section>
    </div>
  );
}
