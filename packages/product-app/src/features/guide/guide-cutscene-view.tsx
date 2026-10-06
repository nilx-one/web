// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useId, useRef, useState } from "react";

import { useLocalization, type TranslationKey } from "../../shell/localization";
import { ACHIEVEMENTS, type AchievementId } from "../progression/progression";
import { GuideConfetti, type GuideXpSubject } from "./guide-confetti";
import type { GuideRewardToast } from "./guide-reward-toasts";
import type { GuideReply } from "./guide-script";
import type { GuideCutsceneState } from "./use-guide-cutscene";
import "./guide-cutscene.css";

/** Quick enough to keep up with reading, slow enough to be her talking. */
export const GUIDE_TYPING_STEP_MS = 28;

/** The Bond's experience lands first, then its Avaia's. */
export const GUIDE_XP_LANDS_MS: Readonly<Record<GuideXpSubject, number>> = {
  bond: 380,
  avaia: 700,
};
/** How long a number takes to count up once its line has landed. */
export const GUIDE_XP_COUNT_MS = 900;
/**
 * When what was paid leaves the scene for the corner: once the last number
 * has counted up and been seen for a moment.
 */
export const GUIDE_XP_FLY_MS =
  GUIDE_XP_LANDS_MS.avaia + GUIDE_XP_COUNT_MS + 800;

type ChipRect = NonNullable<GuideRewardToast["from"]>;

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

/**
 * A number counted up from nothing once its line has landed. Only the eye
 * gets the count: what is read out is the number itself.
 */
function useCountUp(target: number, delayMs: number, animate: boolean): number {
  const [shown, setShown] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) return;
    let frame: number | undefined;
    const started = globalThis.performance.now() + delayMs;
    function step(now: number): void {
      const t = Math.min(1, Math.max(0, (now - started) / GUIDE_XP_COUNT_MS));
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(target * eased));
      if (t < 1) frame = globalThis.requestAnimationFrame(step);
    }
    frame = globalThis.requestAnimationFrame(step);
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
    };
  }, [animate, delayMs, target]);
  return animate ? shown : target;
}

interface GuideXpLineProps {
  readonly subject: GuideXpSubject;
  /** What counts up; a line with no number is shown whole. */
  readonly value: number | undefined;
  readonly label: (value: number | undefined) => string;
  readonly level: boolean;
  /** The first line of a subject is the one its burst goes off from. */
  readonly burst: boolean;
  readonly salt: string;
  readonly animate: boolean;
  chipRef(element: HTMLElement | null): void;
}

/** One line of what was paid, in its subject's colour. */
function GuideXpLine({
  subject,
  value,
  label,
  level,
  burst,
  salt,
  animate,
  chipRef,
}: GuideXpLineProps) {
  const landsMs = GUIDE_XP_LANDS_MS[subject];
  const counted = useCountUp(
    value ?? 0,
    landsMs,
    animate && value !== undefined,
  );
  return (
    <li
      className="guide-xp"
      data-subject={subject}
      data-kind={level ? "level" : "xp"}
    >
      <span className="visually-hidden">{label(value)}</span>
      <span ref={chipRef} className="guide-xp__chip" aria-hidden="true">
        {label(value === undefined ? undefined : counted)}
      </span>
      {animate && burst ? (
        <GuideConfetti subject={subject} salt={salt} delayMs={landsMs} />
      ) : null}
    </li>
  );
}

export interface GuideCutsceneViewProps {
  readonly state: GuideCutsceneState;
  readonly bondName: string;
  readonly avaiaName: string;
  readonly reducedMotion: boolean;
  onChoose(reply: GuideReply): void;
  onAdvance(): void;
  /** What was paid leaves the scene for the corner, as toasts. */
  onRewardFly?(toasts: readonly GuideRewardToast[]): void;
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
  onRewardFly,
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
  const showing =
    state.line.reward && (state.beat === "line" || state.beat === "reply");
  const reward = showing ? state.reward : undefined;
  // A gift scene hands over things instead of experience.
  const gift = showing && reward === undefined ? state.gift : undefined;

  useEffect(() => {
    if (choosing) firstChoiceRef.current?.focus();
    else advanceRef.current?.focus();
  }, [choosing, state.beat, state.line.node]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        const skip = state.line.choices.find(
          (choice) =>
            choice.reply === "skip" ||
            choice.reply === "continue" ||
            choice.reply === "later",
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
  // Everything the scene paid, the Bond's first and then its Avaia's, each
  // in its own colour. Nothing here is priced by the scene: it only reads
  // what the achievement already paid.
  const paid: {
    readonly key: string;
    readonly subject: GuideXpSubject;
    readonly value: number | undefined;
    readonly level: boolean;
    readonly label: (value: number | undefined) => string;
  }[] = [];
  if (reward !== undefined && achievement !== undefined) {
    for (const subject of ["bond", "avaia"] as const) {
      const xp = subject === "bond" ? achievement.bondXp : achievement.avaiaXp;
      if (xp > 0) {
        paid.push({
          key: `${subject}:xp`,
          subject,
          value: xp,
          level: false,
          label: (value) =>
            t(
              subject === "bond" ? "achievement.bondXp" : "achievement.avaiaXp",
            ).replace("{xp}", String(value ?? xp)),
        });
      }
      const before = reward.before[subject].level;
      const after = reward.after[subject].level;
      if (after > before) {
        paid.push({
          key: `${subject}:level`,
          subject,
          value: undefined,
          level: true,
          label: () =>
            t("achievement.level")
              .replace("{name}", subject === "bond" ? bondName : avaiaName)
              .replace("{level}", String(after)),
        });
      }
    }
  }
  if (gift !== undefined) {
    for (const [index, item] of gift.items.entries()) {
      paid.push({
        key: `${item.subject}:gift:${index}`,
        subject: item.subject,
        value: undefined,
        level: true,
        label: () => item.text,
      });
    }
  }

  // Once it has landed and counted up, what was paid leaves the scene for
  // the corner. A scene that moves on sooner sends it on its way from where
  // it was last seen.
  const chipsRef = useRef(new Map<string, HTMLElement>());
  const rectsRef = useRef(new Map<string, ChipRect>());
  const paidRef = useRef(paid);
  const onRewardFlyRef = useRef(onRewardFly);
  useEffect(() => {
    paidRef.current = paid;
    onRewardFlyRef.current = onRewardFly;
  });
  const [flown, setFlown] = useState<string | undefined>(undefined);
  const rewardKey = reward?.achievement ?? gift?.key;
  useEffect(() => {
    if (rewardKey === undefined) return;
    const started = globalThis.performance.now();
    let done = false;
    function measure(): void {
      for (const [key, element] of chipsRef.current) {
        if (!element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        rectsRef.current.set(key, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
      }
    }
    function fly(): void {
      if (done) return;
      done = true;
      const toasts = paidRef.current.map((line, index) => {
        const from = rectsRef.current.get(line.key);
        return {
          key: `${String(rewardKey)}:${line.key}`,
          subject: line.subject,
          kind: line.level ? ("level" as const) : ("xp" as const),
          text: line.label(line.value),
          index,
          ...(from === undefined ? {} : { from }),
        };
      });
      onRewardFlyRef.current?.(toasts);
    }
    const landed = globalThis.setTimeout(
      measure,
      GUIDE_XP_LANDS_MS.avaia + GUIDE_XP_COUNT_MS,
    );
    const away = globalThis.setTimeout(() => {
      measure();
      setFlown(rewardKey);
      fly();
    }, GUIDE_XP_FLY_MS);
    return () => {
      globalThis.clearTimeout(landed);
      globalThis.clearTimeout(away);
      // A development double mount is not the scene moving on.
      if (globalThis.performance.now() - started > 100) fly();
    };
  }, [rewardKey]);

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
        aria-labelledby={
          reward === undefined && gift === undefined ? speakerId : rewardId
        }
      >
        {gift === undefined ? null : (
          <div className="guide-cutscene__reward">
            <h2 className="guide-cutscene__reward-title" id={rewardId}>
              {gift.title}
            </h2>
            <ul
              className="guide-cutscene__rewards"
              data-flown={flown === gift.key ? "true" : undefined}
            >
              {paid.map((line, index) => (
                <GuideXpLine
                  key={line.key}
                  subject={line.subject}
                  value={line.value}
                  label={line.label}
                  level={line.level}
                  burst={
                    paid.findIndex(
                      (other) => other.subject === line.subject,
                    ) === index
                  }
                  salt={gift.key}
                  animate={!reducedMotion}
                  chipRef={(element) => {
                    if (element === null) chipsRef.current.delete(line.key);
                    else chipsRef.current.set(line.key, element);
                  }}
                />
              ))}
            </ul>
          </div>
        )}
        {reward === undefined || achievement === undefined ? null : (
          <div className="guide-cutscene__reward">
            <h2 className="guide-cutscene__reward-title" id={rewardId}>
              {t(TITLE_KEYS[reward.achievement])}
            </h2>
            <ul
              className="guide-cutscene__rewards"
              data-flown={flown === reward.achievement ? "true" : undefined}
            >
              {paid.map((line, index) => (
                <GuideXpLine
                  key={line.key}
                  subject={line.subject}
                  value={line.value}
                  label={line.label}
                  level={line.level}
                  burst={
                    paid.findIndex(
                      (other) => other.subject === line.subject,
                    ) === index
                  }
                  salt={reward.achievement}
                  animate={!reducedMotion}
                  chipRef={(element) => {
                    if (element === null) chipsRef.current.delete(line.key);
                    else chipsRef.current.set(line.key, element);
                  }}
                />
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
