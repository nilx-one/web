// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseLocale,
  declareHostLanguages,
  readLocalePreference,
  resolveLocale,
  translate,
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
});
