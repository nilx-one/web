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

describe("LanguageSettings slider", () => {
  it("defaults to auto and names the detected Ukrainian catalog", () => {
    declareHostLanguages(["uk-RU"]);
    render(<LanguageSettings />);
    const slider = screen.getByRole("slider", { name: "Мова" });
    expect(slider).toHaveValue("0");
    expect(slider).toHaveAttribute("aria-valuetext", "Автоматично");
    expect(screen.getByText("Визначено: Українська")).toBeVisible();
  });

  it("persists English and updates the range immediately", () => {
    declareHostLanguages(["uk-UA"]);
    render(<LanguageSettings />);

    fireEvent.change(screen.getByRole("slider", { name: "Мова" }), {
      target: { value: "1" },
    });

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(screen.getByRole("slider", { name: "Language" })).toHaveValue("1");
    expect(screen.getByRole("slider", { name: "Language" })).toHaveAttribute(
      "aria-valuetext", "English",
    );
  });

  it("persists Ukrainian and keeps the canonical locale tag", () => {
    declareHostLanguages(["en-US"]);
    render(<LanguageSettings />);

    fireEvent.change(screen.getByRole("slider", { name: "Language" }), {
      target: { value: "2" },
    });

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk-UA");
    expect(screen.getByRole("slider", { name: "Мова" })).toHaveAttribute(
      "aria-valuetext", "Українська",
    );
  });

  it("does not offer Russian without a Russian-speaking host", () => {
    declareHostLanguages(["uk-UA"]);
    render(<LanguageSettings />);
    expect(screen.getByRole("slider", { name: "Мова" })).toHaveAttribute("max", "2");
    expect(screen.queryByText("Русский")).not.toBeInTheDocument();
  });

  it("offers Russian on Russian-speaking hosts, including Belarusian", () => {
    declareHostLanguages(["ru-KZ"]);
    const { unmount } = render(<LanguageSettings />);
    expect(screen.getByRole("slider", { name: "Язык" })).toHaveAttribute("max", "3");
    expect(screen.getByText("Определено: Русский")).toBeVisible();
    unmount();
    declareHostLanguages(["be-BY"]);
    render(<LanguageSettings />);
    expect(screen.getByRole("slider", { name: "Мова" })).toHaveAttribute("max", "3");
    fireEvent.change(screen.getByRole("slider", { name: "Мова" }), {
      target: { value: "3" },
    });
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru-RU");
    expect(screen.getByRole("slider", { name: "Язык" })).toHaveValue("3");
  });

  it("keeps a chosen Russian stop even when host language changes", () => {
    chooseLocale("ru-RU");
    declareHostLanguages(["en-US"]);
    render(<LanguageSettings />);
    expect(screen.getByRole("slider", { name: "Язык" })).toHaveAttribute(
      "aria-valuetext", "Русский",
    );
    expect(screen.getByRole("slider", { name: "Язык" })).toHaveValue("3");
  });
});
