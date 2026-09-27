// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseLocale,
  declareHostLanguages,
  DOCK_ACTION_KEYS,
  HOST_LABEL_KEYS,
  offeredLocales,
  readLocalePreference,
  resolveLocale,
  RUNTIME_LABEL_KEYS,
  translate,
  translateCopy,
  translateFirst,
  translateIf,
} from "./localization";

afterEach(() => {
  chooseLocale("auto");
  declareHostLanguages([]);
  window.localStorage.clear();
});

describe("frontend localization", () => {
  it("treats every Ukrainian language tag as Ukrainian regardless of region", () => {
    for (const language of [
      "uk",
      "uk-UA",
      "uk_UA",
      "uk-GB",
      "uk-RU",
      "uk-anything",
    ]) {
      expect(resolveLocale("auto", [], [language])).toBe("uk-UA");
    }
  });

  it("matches the first supported language from ordered device preferences", () => {
    expect(resolveLocale("auto", [], ["fr-FR", "uk-UA", "en-US"])).toBe(
      "uk-UA",
    );
    expect(resolveLocale("auto", [], ["en-GB", "uk-UA"])).toBe("en");
    expect(resolveLocale("auto", [], ["en-UA"])).toBe("en");
  });

  it("lets supported host language evidence outrank the embedded browser", () => {
    expect(resolveLocale("auto", ["uk-RU"], ["en-US"])).toBe("uk-UA");
    expect(resolveLocale("auto", ["en-US"], ["uk-UA"])).toBe("en");
  });

  it("falls through unsupported host evidence before using English fallback", () => {
    expect(resolveLocale("auto", ["fr-FR"], ["uk-UA"])).toBe("uk-UA");
    expect(resolveLocale("auto", ["fr-FR"], ["de-DE"])).toBe("en");
  });

  it("lets an explicit local preference outrank every detected language", () => {
    expect(resolveLocale("en", ["uk-UA"], ["uk-UA"])).toBe("en");
    expect(resolveLocale("uk-UA", ["en-US"], ["en-US"])).toBe("uk-UA");
    chooseLocale("uk-UA");
    expect(readLocalePreference()).toBe("uk-UA");
  });

  it("keeps both catalogs behind the same typed message keys", () => {
    expect(translate("en", "header.settings")).toBe("Settings");
    expect(translate("uk-UA", "header.settings")).toBe("Налаштування");
    expect(translate("uk-UA", "failure.retry")).toBe("Спробувати знову");
  });

  it("translates Dock copy from the catalog and leaves other notes alone", () => {
    const uk = (key: Parameters<typeof translateIf>[1]) =>
      translate("uk-UA", key);
    expect(translate("uk-UA", "dock.save")).toBe("Зберегти");
    expect(translate("uk-UA", "dock.personalBond")).toBe("Особистий Bond");
    expect(
      translateIf(
        uk,
        "dock.caseSensitiveAvaia",
        translate("en", "dock.caseSensitiveAvaia"),
      ),
    ).toBe(translate("uk-UA", "dock.caseSensitiveAvaia"));
    expect(translateIf(uk, "dock.caseSensitiveAvaia", "a different note")).toBe(
      "a different note",
    );
  });

  it("translates settings, sign-out, and host chrome without renaming Bond or Core", () => {
    expect(translate("uk-UA", "header.signOut")).toBe("Вийти");
    expect(translate("uk-UA", "settings.application")).toBe("Застосунок");
    expect(translate("uk-UA", "settings.appearance.lightDetail")).toBe(
      "Залишити мапу світлою",
    );
    expect(translate("uk-UA", "settings.depth.twoD")).toBe("2D");
    expect(translate("uk-UA", "settings.presentation")).toContain("Bond");
    expect(translate("uk-UA", "settings.presentation")).toContain("BondChain");
    expect(translate("uk-UA", "settings.presentation")).toContain("Core");
    expect(translate("uk-UA", "runtime.ready")).toBe("Спільний Core готовий");
    expect(translate("uk-UA", "runtime.contract")).toBe("контракт {version}");
    expect(translate("uk-UA", "host.browser")).toBe("хост браузера");
    expect(translate("en", "header.signOut")).toBe("Sign out");

    const uk = (key: Parameters<typeof translateIf>[1]) =>
      translate("uk-UA", key);
    expect(translateFirst(uk, "browser host", HOST_LABEL_KEYS)).toBe(
      "хост браузера",
    );
    expect(translateFirst(uk, "Shared Core ready", RUNTIME_LABEL_KEYS)).toBe(
      "Спільний Core готовий",
    );
    expect(translateFirst(uk, "a custom host", HOST_LABEL_KEYS)).toBe(
      "a custom host",
    );
    expect(
      translateFirst(uk, "Hand the wheel to x0skai", DOCK_ACTION_KEYS),
    ).toBe("Передати кермо x0skai");
    expect(translateFirst(uk, "Edit 0x0sky", DOCK_ACTION_KEYS)).toBe(
      "Змінити 0x0sky",
    );
    expect(translateFirst(uk, "Edit", DOCK_ACTION_KEYS)).toBe("Edit");
    expect(translate("uk-UA", "dock.you")).toBe("Ви");
    expect(translate("uk-UA", "dock.spectate")).toBe("спостерігає");
  });

  it("carries every filled-in placeholder, including repeated ones, into the translation", () => {
    const uk = (key: Parameters<typeof translateIf>[1]) =>
      translate("uk-UA", key);
    expect(translateCopy(uk, "Connecting Discord to 0x0sky…")).toBe(
      "Підключаємо Discord до 0x0sky…",
    );
    expect(translateCopy(uk, "Case-sensitive · 2–32 characters")).toBe(
      "З урахуванням регістру · 2–32 символи",
    );
    expect(translateCopy(uk, "Case-sensitive · 3–40 characters")).toBe(
      "З урахуванням регістру · символів: 3–40",
    );
    expect(
      translateCopy(
        uk,
        "Could not connect GitHub to this Bond. Authorize GitHub again.",
      ),
    ).toBe(
      "Не вдалося підключити GitHub до цього Bond. Авторизуйте GitHub ще раз.",
    );
    expect(
      translateCopy(
        uk,
        "Could not connect GitHub to this Bond. Authorize Discord again.",
      ),
    ).toBe("Could not connect GitHub to this Bond. Authorize Discord again.");
  });

  it("prefers an exact catalog sentence over a template that would also match", () => {
    const uk = (key: Parameters<typeof translateIf>[1]) =>
      translate("uk-UA", key);
    expect(
      translateCopy(uk, "Could not connect Telegram to this Bond right now."),
    ).toBe("Зараз не вдалося підключити Telegram до цього Bond.");
    expect(translateCopy(uk, "Could not connect Discord right now.")).toBe(
      "Зараз не вдалося підключити Discord.",
    );
  });

  it("presents view-model copy in Ukrainian and leaves unknown wording alone", () => {
    const uk = (key: Parameters<typeof translateIf>[1]) =>
      translate("uk-UA", key);
    expect(translateCopy(uk, "Map unavailable")).toBe("Мапа недоступна");
    expect(translateCopy(uk, "Bond found — sign in")).toBe(
      "Bond знайдено — увійдіть",
    );
    expect(translateCopy(uk, "Disconnect Telegram from this Bond")).toBe(
      "Від’єднати Telegram від цього Bond",
    );
    expect(
      translateCopy(uk, "Change your 3D model — currently Dasha 2.0"),
    ).toBe("Змінити свою 3D модель — зараз Dasha 2.0");
    expect(translateCopy(uk, "Couldn’t save this choice. Try again.")).toBe(
      "Не вдалося зберегти цей вибір. Спробуйте ще раз.",
    );
    expect(translateCopy(uk, "Something no catalog says")).toBe(
      "Something no catalog says",
    );
    const en = (key: Parameters<typeof translateIf>[1]) => translate("en", key);
    expect(translateCopy(en, "Connecting Discord to 0x0sky…")).toBe(
      "Connecting Discord to 0x0sky…",
    );
  });

  it("resolves Russian from any ru-* tag and Belarusian to Ukrainian", () => {
    for (const language of ["ru", "ru-RU", "ru_UA", "ru-KZ"]) {
      expect(resolveLocale("auto", [], [language])).toBe("ru-RU");
    }
    expect(resolveLocale("auto", [], ["be-BY"])).toBe("uk-UA");
    expect(resolveLocale("auto", [], ["be"])).toBe("uk-UA");
    expect(resolveLocale("auto", ["be-BY"], ["ru-RU"])).toBe("uk-UA");
    expect(resolveLocale("auto", [], ["ru-RU", "be-BY"])).toBe("ru-RU");
    expect(resolveLocale("ru-RU", ["uk-UA"], ["en-US"])).toBe("ru-RU");
  });

  it("offers Russian only to Russian or Belarusian speakers, or a standing choice", () => {
    expect(offeredLocales("auto", [], ["en-US"])).toEqual(["en", "uk-UA"]);
    expect(offeredLocales("auto", ["uk-UA"], ["pl-PL"])).toEqual([
      "en",
      "uk-UA",
    ]);
    expect(offeredLocales("auto", [], ["en-US", "ru-RU"])).toEqual([
      "en",
      "uk-UA",
      "ru-RU",
    ]);
    expect(offeredLocales("auto", ["be-BY"], [])).toEqual([
      "en",
      "uk-UA",
      "ru-RU",
    ]);
    expect(offeredLocales("ru-RU", [], ["en-US"])).toContain("ru-RU");
  });

  it("presents catalog and view-model copy in Russian without renaming proper names", () => {
    const ru = (key: Parameters<typeof translateIf>[1]) =>
      translate("ru-RU", key);
    expect(translate("ru-RU", "header.signOut")).toBe("Выйти");
    expect(translate("ru-RU", "settings.language.russian")).toBe("Русский");
    expect(translate("ru-RU", "settings.presentation")).toContain("BondChain");
    expect(translateCopy(ru, "Connecting Discord to 0x0sky…")).toBe(
      "Подключаем Discord к 0x0sky…",
    );
    expect(
      translateFirst(ru, "Hand the wheel to x0skai", DOCK_ACTION_KEYS),
    ).toBe("Передать руль x0skai");
  });
});
