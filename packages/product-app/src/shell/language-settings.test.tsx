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

  it("does not offer Russian to hosts and devices that do not speak it", () => {
    declareHostLanguages(["uk-UA"]);
    render(<LanguageSettings />);

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(
      screen.queryByRole("radio", { name: "Русский" }),
    ).not.toBeInTheDocument();
  });

  it("offers Russian to a Russian host and resolves to it automatically", () => {
    declareHostLanguages(["ru-KZ"]);
    render(<LanguageSettings />);

    expect(screen.getByRole("group", { name: "Язык" })).toBeVisible();
    expect(screen.getByText("Определено: Русский")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Русский" })).toBeVisible();
  });

  it("defaults a Belarusian host to Ukrainian and still offers Russian", () => {
    declareHostLanguages(["be-BY"]);
    render(<LanguageSettings />);

    expect(screen.getByText("Визначено: Українська")).toBeVisible();

    fireEvent.click(screen.getByRole("radio", { name: "Русский" }));

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru-RU");
    expect(screen.getByRole("group", { name: "Язык" })).toBeVisible();
    expect(screen.getByRole("radio", { name: "Русский" })).toBeChecked();
  });

  it("keeps a standing Russian choice selectable once the host stops speaking it", () => {
    chooseLocale("ru-RU");
    declareHostLanguages(["en-US"]);
    render(<LanguageSettings />);

    expect(screen.getByRole("radio", { name: "Русский" })).toBeChecked();
  });
});
