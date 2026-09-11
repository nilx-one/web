// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useSyncExternalStore } from "react";

/** A real language locale the product can render today. */
export type ProductLocale = "en" | "uk-UA";

/** `auto` follows available host/device language evidence; an explicit locale is local UI state. */
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
  "location.unsupported.label": "Location unavailable on this host",
  "location.unsupported.hint": "This host provides no device location.",
  "location.denied.label": "Location permission denied",
  "location.denied.hint":
    "Location is blocked for this site in your browser settings.",
  "location.enable.label": "Enable location",
  "location.enable.hint": "Show this device on the map.",
  "location.locating.label": "Locating this device",
  "location.locating.hint": "Waiting for a position from this device.",
  "location.unavailable.retryLabel": "Location unavailable, try again",
  "location.unavailable.recenterLabel": "Recenter on the last known position",
  "location.unavailable.timeoutHint": "This device did not answer in time.",
  "location.unavailable.positionHint":
    "This device could not resolve a position.",
  "location.centered.label": "Map centred on this device",
  "location.recenter.label": "Recenter on this device",
  "location.accuracy.approx": "Accuracy about",
  "settings.language.legend": "Language",
  "settings.language.auto": "Auto",
  "settings.language.autoAction": "Use detected language",
  "settings.language.detected.en": "Detected: English",
  "settings.language.detected.uk": "Detected: Ukrainian",
  "settings.language.english": "English",
  "settings.language.ukrainian": "Українська",
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
  "location.unsupported.label": "Геолокація недоступна в цьому хості",
  "location.unsupported.hint": "Цей хост не надає геолокацію пристрою.",
  "location.denied.label": "Доступ до геолокації заборонено",
  "location.denied.hint":
    "Геолокацію заблоковано для цього сайту в налаштуваннях браузера.",
  "location.enable.label": "Увімкнути геолокацію",
  "location.enable.hint": "Показати цей пристрій на мапі.",
  "location.locating.label": "Визначаємо місцезнаходження",
  "location.locating.hint": "Очікуємо координати від цього пристрою.",
  "location.unavailable.retryLabel":
    "Геолокація недоступна — спробувати ще раз",
  "location.unavailable.recenterLabel":
    "Повернутися до останньої відомої позиції",
  "location.unavailable.timeoutHint": "Пристрій не відповів вчасно.",
  "location.unavailable.positionHint":
    "Пристрою не вдалося визначити позицію.",
  "location.centered.label": "Мапа центрована на цьому пристрої",
  "location.recenter.label": "Центрувати на цьому пристрої",
  "location.accuracy.approx": "Точність близько",
  "settings.language.legend": "Мова",
  "settings.language.auto": "Автоматично",
  "settings.language.autoAction": "Використовувати визначену мову",
  "settings.language.detected.en": "Визначено: English",
  "settings.language.detected.uk": "Визначено: Українська",
  "settings.language.english": "English",
  "settings.language.ukrainian": "Українська",
};

const CATALOGS: Readonly<
  Record<ProductLocale, Readonly<Record<TranslationKey, string>>>
> = {
  en: EN_MESSAGES,
  "uk-UA": UK_MESSAGES,
};

function supportedLocale(tag: string): ProductLocale | undefined {
  const language = tag.trim().replaceAll("_", "-").toLowerCase().split("-")[0];
  if (language === "uk") return "uk-UA";
  if (language === "en") return "en";
  return undefined;
}

function firstSupportedLocale(
  languages: readonly string[],
): ProductLocale | undefined {
  for (const language of languages) {
    const locale = supportedLocale(language);
    if (locale !== undefined) return locale;
  }
  return undefined;
}

/**
 * Resolve from explicit local preference, then ordered host evidence, then
 * ordered browser/device languages, then English. Region subtags never change
 * the language family: every `uk-*` tag resolves to the Ukrainian catalog.
 */
export function resolveLocale(
  preference: LocalePreference,
  hostLanguages: readonly string[],
  deviceLanguages: readonly string[],
): ProductLocale {
  if (preference !== "auto") return preference;
  return (
    firstSupportedLocale(hostLanguages) ??
    firstSupportedLocale(deviceLanguages) ??
    DEFAULT_LOCALE
  );
}

export function translate(locale: ProductLocale, key: TranslationKey): string {
  return CATALOGS[locale][key];
}

let sessionPreference: LocalePreference | undefined;
let hostLanguageEvidence: readonly string[] = [];
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
    // Storage is optional. The interface remains usable with detected language.
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

/**
 * Supply ordered host language hints before the product mounts. These hints are
 * presentation evidence only: they must never be promoted to authentication or
 * protocol truth. An empty list removes host-specific evidence.
 */
export function declareHostLanguages(languages: readonly string[]): void {
  const next = languages.map((language) => language.trim()).filter(Boolean);
  if (
    next.length === hostLanguageEvidence.length &&
    next.every((language, index) => language === hostLanguageEvidence[index])
  ) {
    return;
  }
  hostLanguageEvidence = next;
  notify();
}

function deviceLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (navigator.languages.length > 0) return navigator.languages;
  return navigator.language.length > 0 ? [navigator.language] : [];
}

function currentAutoLocale(): ProductLocale {
  return resolveLocale("auto", hostLanguageEvidence, deviceLanguages());
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
  const autoLocale = useSyncExternalStore(
    subscribe,
    currentAutoLocale,
    () => DEFAULT_LOCALE,
  );
  const resolved = preference === "auto" ? autoLocale : preference;
  const t = useCallback<Translate>(
    (key) => translate(resolved, key),
    [resolved],
  );

  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);

  return { preference, resolved, t };
}
