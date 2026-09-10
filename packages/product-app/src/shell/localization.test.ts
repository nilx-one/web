// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseLocale,
  readLocalePreference,
  resolveLocale,
  translate,
} from "./localization";

afterEach(() => {
  chooseLocale("auto");
  window.localStorage.clear();
});

describe("frontend localization", () => {
  it("matches supported languages from ordered browser preferences", () => {
    expect(resolveLocale("auto", ["fr-FR", "uk-UA", "en-US"])).toBe("uk-UA");
    expect(resolveLocale("auto", ["uk_UA"])).toBe("uk-UA");
    expect(resolveLocale("auto", ["en-GB"])).toBe("en");
  });

  it("falls back deterministically when the device language is unsupported", () => {
    expect(resolveLocale("auto", ["fr-FR", "de-DE"])).toBe("en");
  });

  it("lets an explicit local preference outrank the device", () => {
    expect(resolveLocale("uk-UA", ["en-US"])).toBe("uk-UA");
    chooseLocale("uk-UA");
    expect(readLocalePreference()).toBe("uk-UA");
  });

  it("keeps both catalogs behind the same typed message keys", () => {
    expect(translate("en", "header.settings")).toBe("Settings");
    expect(translate("uk-UA", "header.settings")).toBe("Налаштування");
    expect(translate("uk-UA", "failure.retry")).toBe("Спробувати знову");
  });
});
