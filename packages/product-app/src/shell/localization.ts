// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** A real language locale the product can render today. */
export type ProductLocale = "en" | "uk-UA";

/** `auto` follows the browser/device language; an explicit locale is local UI state. */
export type LocalePreference = ProductLocale | "auto";

export const LOCALE_STORAGE_KEY = "nilx-one.interface.locale";
export const DEFAULT_LOCALE: ProductLocale = "en";
export const SUPPORTED_LOCALES: readonly ProductLocale[] = ["en", "uk-UA"];

const EN_MESSAGES = {
  "failure.region": "Failure notices",
  "failure.retry": "Try again",
  "failure.unavailable.title": "Request unanswered",
  "failure.unavailable.description":
    "Nothing could answer this request, so nothing was decided and nothing was substituted.",
  "failure.withheld.title": "Declined by authority",
  "failure.withheld.description":
    "Authority was asked and the answer was no; this is a decision, not a malfunction.",
  "failure.gated.title": "Not acting right now",
  "failure.gated.description":
    "The runtime is dormant or winding down, so it is not acting in its current mode.",
  "failure.rejected.title": "Request rejected",
  "failure.rejected.description":
    "The request contradicted the contract and was refused; an operator needs to look at this.",
  "failure.exhausted.title": "Limit reached",
  "failure.exhausted.description":
    "A counter for this operation hit its ceiling; an operator needs to look at this.",
  "header.world": "0x1 world",
  "header.navigation": "0x1 navigation",
  "header.settings": "Settings",
  "header.more": "More",
} as const;

export type TranslationKey = keyof typeof EN_MESSAGES;
export type Translate = (key: TranslationKey) => string;

const UK_MESSAGES: Readonly<Record<TranslationKey, string>> = {
  "failure.region": "Сповіщення про помилки",
  "failure.retry": "Спробувати знову",
  "failure.unavailable.title": "Запит без відповіді",
  "failure.unavailable.description":
    "На цей запит не вдалося отримати відповідь, тому нічого не було вирішено й нічим не підмінено.",
  "failure.withheld.title": "Рішення: відмова",
  "failure.withheld.description":
    "Повноважний компонент отримав запит і відповів «ні»; це рішення, а не збій.",
  "failure.gated.title": "Зараз не виконується",
  "failure.gated.description":
    "Runtime неактивний або завершує роботу, тому зараз не діє у поточному режимі.",
  "failure.rejected.title": "Запит відхилено",
  "failure.rejected.description":
    "Запит суперечить контракту й був відхилений; це потребує уваги оператора.",
  "failure.exhausted.title": "Ліміт вичерпано",
  "failure.exhausted.description":
    "Лічильник цієї операції досяг межі; це потребує уваги оператора.",
  "header.world": "Світ 0x1",
  "header.navigation": "Навігація 0x1",
  "header.settings": "Налаштування",
  "header.more": "Більше",
};

const CATALOGS: Readonly<
  Record<ProductLocale, Readonly<Record<TranslationKey, string>>>
> = {
  en: EN_MESSAGES,
  "uk-UA": UK_MESSAGES,
};

function supportedLocale(tag: string): ProductLocale | undefined {
  const language = tag
    .trim()
    .replaceAll("_", "-")
    .toLowerCase()
    .split("-")[0];
  if (language === "uk") return "uk-UA";
  if (language === "en") return "en";
  return undefined;
}

/** Resolve once from explicit local preference, then ordered device languages, then English. */
export function resolveLocale(
  preference: LocalePreference,
  deviceLanguages: readonly string[],
): ProductLocale {
  if (preference !== "auto") return preference;
  for (const language of deviceLanguages) {
    const locale = supportedLocale(language);
    if (locale !== undefined) return locale;
  }
  return DEFAULT_LOCALE;
}

export function translate(locale: ProductLocale, key: TranslationKey): string {
  return CATALOGS[locale][key];
}

let sessionPreference: LocalePreference | undefined;
const listeners = new Set<() => void>();
let deviceLanguageWatched = false;

function notify(): void {
  for (const listener of listeners) listener();
}

export function readLocalePreference(): LocalePreference {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "auto" || stored === "en" || stored === "uk-UA") {
      return stored;
    }
  } catch {
    // Storage is optional. The interface remains usable with device language.
  }
  return "auto";
}

/** A person's standing language choice. It never enters Bond, BondChain, or Core state. */
export function chooseLocale(preference: LocalePreference): void {
  sessionPreference = preference;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // Persistence is best-effort only; the choice still applies this session.
  }
  notify();
}

function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language.length > 0 ? [navigator.language] : [];
}

function currentDeviceLocale(): ProductLocale {
  return resolveLocale("auto", deviceLanguages());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!deviceLanguageWatched && typeof window !== "undefined") {
    window.addEventListener("languagechange", notify);
    deviceLanguageWatched = true;
  }
  return () => listeners.delete(listener);
}

export interface LocalizationState {
  readonly preference: LocalePreference;
  readonly resolved: ProductLocale;
  readonly t: Translate;
}

/** One frontend-owned locale store shared by every product host. */
export function useLocalization(): LocalizationState {
  const preference = useSyncExternalStore(
    subscribe,
    readLocalePreference,
    () => "auto" as LocalePreference,
  );
  const deviceLocale = useSyncExternalStore(
    subscribe,
    currentDeviceLocale,
    () => DEFAULT_LOCALE,
  );
  const resolved = preference === "auto" ? deviceLocale : preference;
  const t = useCallback<Translate>(
    (key) => translate(resolved, key),
    [resolved],
  );

  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);

  return { preference, resolved, t };
}
