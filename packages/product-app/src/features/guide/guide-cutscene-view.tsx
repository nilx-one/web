// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useId, useRef, useState } from "react";

import { useLocalization, type TranslationKey } from "../../shell/localization";
import { ACHIEVEMENTS, type AchievementId } from "../progression/progression";
import type { GuideReply } from "./guide-script";
import type { GuideCutsceneState } from "./use-guide-cutscene";
import "./guide-cutscene.css";

/** Quick enough to keep up with reading, slow enough to be her talking. */
export const GUIDE_TYPING_STEP_MS = 28;

const TITLE_KEYS: Readonly<Record<AchievementId, TranslationKey>> = {
  "avaia-configured": "achievement.avaiaConfigured",
  "avaia-model-downloaded": "achievement.avaiaModelDownloaded",
};

/**
 * How much of a line has been said. A line is typed out as she says it; a
 * person may hurry it to the end, and one who asked for reduced motion reads
 * it whole.
 */
function useTypedLine(
  text: string,
  animate: boolean,
): { readonly shown: string; readonly done: boolean; complete(): void } {
  const scalars = [...text];
  const [typed, setTyped] = useState<{ text: string; count: number }>({
    text,
    count: animate ? 0 : scalars.length,
  });
  const count =
    typed.text === text ? typed.count : animate ? 0 : scalars.length;
  if (typed.text !== text) setTyped({ text, count });
  const done = count >= scalars.length;

  useEffect(() => {
    if (done) return;
    const next = globalThis.setTimeout(
      () => setTyped({ text, count: count + 1 }),
      GUIDE_TYPING_STEP_MS,
    );
    return () => globalThis.clearTimeout(next);
  }, [count, done, text]);

  return {
    shown: done ? text : scalars.slice(0, count).join(""),
    done,
    complete: () => setTyped({ text, count: scalars.length }),
  };
}

export interface GuideCutsceneViewProps {
  readonly state: GuideCutsceneState;
  readonly bondName: string;
  readonly avaiaName: string;
  readonly reducedMotion: boolean;
  onChoose(reply: GuideReply): void;
  onAdvance(): void;
}

/**
 * A scene played over the world, the way a cutscene is: the frame narrows to
 * letterbox, the chrome steps aside, and what she says is set in subtitles
 * with the replies a person can give beneath them. The world stays mounted
 * underneath and is what the camera is filming.
 */
export function GuideCutsceneView({
  state,
  bondName,
  avaiaName,
  reducedMotion,
  onChoose,
  onAdvance,
}: GuideCutsceneViewProps) {
  const { t } = useLocalization();
  const speakerId = useId();
  const rewardId = useId();
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const advanceRef = useRef<HTMLButtonElement>(null);
  const saying = state.beat === "reply" ? (state.reply ?? "") : state.line.text;
  const typed = useTypedLine(
    state.beat === "line" || state.beat === "reply" ? saying : "",
    !reducedMotion,
  );
  const choosing = state.beat === "line" && typed.done;
  // What the scene paid is shown as she says it, and stays while it is
  // answered — not while she is still on her way.
  const reward =
    state.reward !== undefined &&
    state.line.reward &&
    (state.beat === "line" || state.beat === "reply")
      ? state.reward
      : undefined;

  useEffect(() => {
    if (choosing) firstChoiceRef.current?.focus();
    else advanceRef.current?.focus();
  }, [choosing, state.beat, state.line.node]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        const skip = state.line.choices.find(
          (choice) => choice.reply === "skip" || choice.reply === "continue",
        );
        if (choosing && skip !== undefined) onChoose(skip.reply);
        else if (state.beat === "line") typed.complete();
        else onAdvance();
        return;
      }
      if (!choosing) return;
      const index = Number.parseInt(event.key, 10) - 1;
      const choice = Number.isNaN(index)
        ? undefined
        : state.line.choices[index];
      if (choice === undefined) return;
      event.preventDefault();
      onChoose(choice.reply);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function hurry(): void {
    if (state.beat === "line" || state.beat === "reply") {
      if (!typed.done) {
        typed.complete();
        return;
      }
      if (state.beat === "line") return;
    }
    onAdvance();
  }

  const achievement =
    reward === undefined ? undefined : ACHIEVEMENTS[reward.achievement];
  const levels =
    reward === undefined
      ? []
      : [
          reward.after.bond.level > reward.before.bond.level
            ? { name: bondName, level: reward.after.bond.level }
            : undefined,
          reward.after.avaia.level > reward.before.avaia.level
            ? { name: avaiaName, level: reward.after.avaia.level }
            : undefined,
        ].filter((entry) => entry !== undefined);

  return (
    <div
      className="guide-cutscene"
      data-beat={state.beat}
      data-scene={state.scene}
    >
      <div
        className="guide-cutscene__bar guide-cutscene__bar--top"
        aria-hidden="true"
      />
      <div
        className="guide-cutscene__bar guide-cutscene__bar--bottom"
        aria-hidden="true"
      />
      <section
        className="guide-cutscene__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={reward === undefined ? speakerId : rewardId}
      >
        {reward === undefined || achievement === undefined ? null : (
          <div className="guide-cutscene__reward">
            <h2 className="guide-cutscene__reward-title" id={rewardId}>
              {t(TITLE_KEYS[reward.achievement])}
            </h2>
            <ul className="guide-cutscene__rewards">
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
                <li key={entry.name} className="guide-cutscene__level">
                  {t("achievement.level")
                    .replace("{name}", entry.name)
                    .replace("{level}", String(entry.level))}
                </li>
              ))}
            </ul>
            {reward.next === "download" ? (
              <p className="guide-cutscene__next">
                <i className="attention-dot" aria-hidden="true" />
                {t("achievement.nextDownload")}
              </p>
            ) : null}
          </div>
        )}
        <p
          className="guide-cutscene__speaker"
          id={speakerId}
          data-speaker={state.beat === "reply" ? "you" : "guide"}
        >
          {state.beat === "reply" ? state.replySpeaker : state.line.speaker}
        </p>
        <p className="guide-cutscene__line" aria-live="polite">
          {state.beat === "arriving" || state.beat === "leaving" ? (
            <span className="guide-cutscene__ellipsis" aria-hidden="true">
              …
            </span>
          ) : (
            <>
              <span>{typed.shown}</span>
              {typed.done ? null : (
                <span className="guide-cutscene__caret" aria-hidden="true" />
              )}
            </>
          )}
        </p>
        {choosing ? (
          <ol className="guide-cutscene__choices">
            {state.line.choices.map((choice, index) => (
              <li key={choice.reply}>
                <button
                  ref={index === 0 ? firstChoiceRef : undefined}
                  className="guide-cutscene__choice"
                  type="button"
                  data-reply={choice.reply}
                  onClick={() => onChoose(choice.reply)}
                >
                  <span
                    className="guide-cutscene__choice-number"
                    aria-hidden="true"
                  >
                    {index + 1}.
                  </span>
                  <span>{choice.text}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <button
            ref={advanceRef}
            className="guide-cutscene__advance"
            type="button"
            onClick={hurry}
          >
            {t("guide.cutscene.advance")}
          </button>
        )}
      </section>
    </div>
  );
}
