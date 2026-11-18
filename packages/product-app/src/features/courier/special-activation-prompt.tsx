// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ProductLocale } from "../../shell/localization";
import "./special-activation-prompt.css";

const copy = {
  "uk-UA": {
    title: "Special 1 міс. у рюкзаку",
    question: "Активувати зараз?",
    yes: "Так",
    skip: "Пропустити",
    busy: "Активуємо…",
    kept: "Без активної підписки Special треба активувати одразу.",
    running: "Special ще діє {left} — додати місяць після нього?",
    add: "Додати",
    later: "Пізніше",
    days: "{n} дн.",
    hours: "{n} год.",
    paused: "Exclusive діє: Special стане на паузу й почнеться після нього.",
  },
  "ru-RU": {
    title: "Special 1 мес. в рюкзаке",
    question: "Активировать сейчас?",
    yes: "Да",
    skip: "Пропустить",
    busy: "Активируем…",
    kept: "Без активной подписки Special нужно активировать сразу.",
    running: "Special ещё действует {left} — добавить месяц после него?",
    add: "Добавить",
    later: "Позже",
    days: "{n} дн.",
    hours: "{n} ч.",
    paused:
      "Exclusive действует: Special встанет на паузу и начнётся после него.",
  },
  en: {
    title: "Special 1 mo. in your backpack",
    question: "Activate now?",
    yes: "Yes",
    skip: "Skip",
    busy: "Activating…",
    kept: "Without an active subscription Special has to be activated right away.",
    running: "Special still runs for {left} — add the month after it?",
    add: "Add",
    later: "Later",
    days: "{n} d",
    hours: "{n} h",
    paused: "Exclusive is running: Special waits paused and starts after it.",
  },
} as const;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Asked once, when xPing has put a purchased Special into the backpack, and
 * again when Core says a Special still runs: then the answer is whether to
 * add this month to its end, or keep the item for later.
 * Under Exclusive a Special never runs alongside it: it waits, paused.
 * Skipping leaves the item where it is, to be activated later; it is offered
 * only to a Bond whose subscription is already running. Without one the item
 * could only sit unused, so the question has the one answer.
 */
export function SpecialActivationPrompt({
  locale,
  canSkip,
  busy,
  stillRunningMs,
  exclusive = false,
  onActivate,
  onSkip,
}: {
  locale: ProductLocale;
  /** True only while a subscription is active. */
  canSkip: boolean;
  busy: boolean;
  /** Set when Core refused: the Special left, running or paused. */
  stillRunningMs?: number;
  /** Exclusive runs now, so the Special this starts waits behind it. */
  exclusive?: boolean;
  onActivate(): void;
  onSkip(): void;
}) {
  const t = copy[locale];
  const running = stillRunningMs !== undefined;
  const skip = canSkip || running;
  const left =
    stillRunningMs === undefined
      ? ""
      : stillRunningMs >= DAY_MS
        ? t.days.replace("{n}", String(Math.floor(stillRunningMs / DAY_MS)))
        : t.hours.replace(
            "{n}",
            String(Math.max(1, Math.floor(stillRunningMs / HOUR_MS))),
          );
  return (
    <section
      className="special-activation"
      role="alertdialog"
      aria-labelledby="special-activation-title"
      aria-describedby="special-activation-question"
    >
      <strong id="special-activation-title">{t.title}</strong>
      <p id="special-activation-question">
        {running ? t.running.replace("{left}", left) : t.question}
      </p>
      {exclusive && <small>{t.paused}</small>}
      {!skip && <small>{t.kept}</small>}
      <div className="special-activation__actions">
        <button type="button" disabled={busy} onClick={onActivate}>
          {busy ? t.busy : running ? t.add : t.yes}
        </button>
        {skip && (
          <button type="button" disabled={busy} onClick={onSkip}>
            {running ? t.later : t.skip}
          </button>
        )}
      </div>
    </section>
  );
}
