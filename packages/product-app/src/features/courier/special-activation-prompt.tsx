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
  },
  "ru-RU": {
    title: "Special 1 мес. в рюкзаке",
    question: "Активировать сейчас?",
    yes: "Да",
    skip: "Пропустить",
    busy: "Активируем…",
    kept: "Без активной подписки Special нужно активировать сразу.",
  },
  en: {
    title: "Special 1 mo. in your backpack",
    question: "Activate now?",
    yes: "Yes",
    skip: "Skip",
    busy: "Activating…",
    kept: "Without an active subscription Special has to be activated right away.",
  },
} as const;

/**
 * Asked once, when xPing has put a purchased Special into the backpack.
 * Skipping leaves the item where it is, to be activated later; it is offered
 * only to a Bond whose subscription is already running. Without one the item
 * could only sit unused, so the question has the one answer.
 */
export function SpecialActivationPrompt({
  locale,
  canSkip,
  busy,
  onActivate,
  onSkip,
}: {
  locale: ProductLocale;
  /** True only while a subscription is active. */
  canSkip: boolean;
  busy: boolean;
  onActivate(): void;
  onSkip(): void;
}) {
  const t = copy[locale];
  return (
    <section
      className="special-activation"
      role="alertdialog"
      aria-labelledby="special-activation-title"
      aria-describedby="special-activation-question"
    >
      <strong id="special-activation-title">{t.title}</strong>
      <p id="special-activation-question">{t.question}</p>
      {!canSkip && <small>{t.kept}</small>}
      <div className="special-activation__actions">
        <button type="button" disabled={busy} onClick={onActivate}>
          {busy ? t.busy : t.yes}
        </button>
        {canSkip && (
          <button type="button" disabled={busy} onClick={onSkip}>
            {t.skip}
          </button>
        )}
      </div>
    </section>
  );
}
