// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  chooseLocale,
  declareHostLanguages,
  DOCK_ACTION_KEYS,
  HOST_LABEL_KEYS,
  readLocalePreference,
  resolveLocale,
  RUNTIME_LABEL_KEYS,
  translate,
  translateFirst,
  translateIf,
  translateNamedFirst,
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
      translateNamedFirst(uk, "Hand the wheel to x0skai", DOCK_ACTION_KEYS),
    ).toBe("Передати кермо x0skai");
    expect(translateNamedFirst(uk, "Edit 0x0sky", DOCK_ACTION_KEYS)).toBe(
      "Змінити 0x0sky",
    );
    expect(translateNamedFirst(uk, "Edit", DOCK_ACTION_KEYS)).toBe("Edit");
    expect(translate("uk-UA", "dock.you")).toBe("Ви");
    expect(translate("uk-UA", "dock.spectate")).toBe("спостерігає");
  });
});
