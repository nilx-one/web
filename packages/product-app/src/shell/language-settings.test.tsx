// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LanguageSettings } from "./language-settings";
import {
  chooseLocale,
  declareHostLanguages,
  LOCALE_STORAGE_KEY,
} from "./localization";

afterEach(() => {
  chooseLocale("auto");
  declareHostLanguages([]);
  window.localStorage.clear();
});

describe("LanguageSettings", () => {
  it("defaults to auto and names the detected Ukrainian catalog", () => {
    declareHostLanguages(["uk-RU"]);

    render(<LanguageSettings />);

    expect(screen.getByRole("group", { name: "Мова" })).toBeVisible();
    expect(
      screen.getByRole("radio", { name: "Використовувати визначену мову" }),
    ).toBeChecked();
    expect(screen.getByText("Визначено: Українська")).toBeVisible();
  });

  it("persists an explicit English choice and rerenders the selector immediately", () => {
    declareHostLanguages(["uk-UA"]);
    render(<LanguageSettings />);

    fireEvent.click(screen.getByRole("radio", { name: "English" }));

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(screen.getByRole("group", { name: "Language" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "English" })).toBeChecked();
  });

  it("persists Ukrainian and keeps the canonical locale tag", () => {
    declareHostLanguages(["en-US"]);
    render(<LanguageSettings />);

    fireEvent.click(screen.getByRole("radio", { name: "Українська" }));

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk-UA");
    expect(screen.getByRole("group", { name: "Мова" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Українська" })).toBeChecked();
  });
});
