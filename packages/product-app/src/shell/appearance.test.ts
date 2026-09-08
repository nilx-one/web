// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  chooseAppearance,
  deviceAppearance,
  readAppearancePreference,
  resolveAppearance,
} from "./appearance";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-appearance");
});

describe("appearance resolution", () => {
  it("defers to the device only while nothing was chosen", () => {
    expect(resolveAppearance("auto", "dark")).toBe("dark");
    expect(resolveAppearance("auto", "light")).toBe("light");
  });

  it("keeps a standing choice against the device", () => {
    expect(resolveAppearance("light", "dark")).toBe("light");
    expect(resolveAppearance("dark", "light")).toBe("dark");
  });

  // The one invariant the sign-in surface depends on: an unanswered question
  // is never answered with black.
  it("opens light when the device does not ask for dark", () => {
    expect(deviceAppearance()).toBe("light");
    expect(
      resolveAppearance(readAppearancePreference(), deviceAppearance()),
    ).toBe("light");
  });
});

describe("appearance preference", () => {
  it("starts on auto and reads back what was chosen", () => {
    expect(readAppearancePreference()).toBe("auto");

    chooseAppearance("dark");

    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
    expect(readAppearancePreference()).toBe("dark");
  });

  it("ignores a stored value it does not recognise", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "midnight");

    expect(readAppearancePreference()).toBe("auto");
  });
});

describe("applied appearance", () => {
  it("stamps the document and the host chrome from one resolution", () => {
    const chrome = document.createElement("meta");
    chrome.setAttribute("name", "theme-color");
    document.head.append(chrome);

    applyAppearance("dark");

    expect(document.documentElement.getAttribute("data-appearance")).toBe(
      "dark",
    );
    expect(chrome.getAttribute("content")).toBe("#121116");

    applyAppearance("light");

    expect(document.documentElement.getAttribute("data-appearance")).toBe(
      "light",
    );
    expect(chrome.getAttribute("content")).toBe("#f3f8fc");

    chrome.remove();
  });
});
