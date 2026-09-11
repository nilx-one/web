// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { TelegramWebAppBridge } from "@nilx-one/host-telegram";
import {
  APPEARANCE_ATTRIBUTE,
  APPEARANCE_STORAGE_KEY,
} from "@nilx-one/product-app/appearance";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  initialTelegramAppearance,
  startTelegramChromeAppearanceSync,
} from "./appearance";

function createBridge(
  colorScheme: TelegramWebAppBridge["colorScheme"] = "dark",
): TelegramWebAppBridge {
  return {
    initData: "signed",
    colorScheme,
    setHeaderColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    setBottomBarColor: vi.fn(),
    ready: vi.fn(),
    expand: vi.fn(),
    openLink: vi.fn(),
    onEvent: vi.fn(),
    offEvent: vi.fn(),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(APPEARANCE_ATTRIBUTE);
});

describe("Telegram chrome appearance composition", () => {
  it("resolves auto from Telegram's current device appearance", () => {
    const bridge = createBridge("dark");

    expect(initialTelegramAppearance(bridge)).toBe("dark");

    const stop = startTelegramChromeAppearanceSync(bridge);
    expect(bridge.setHeaderColor).toHaveBeenCalledWith("#121116");
    expect(bridge.setBackgroundColor).toHaveBeenCalledWith("#121116");
    expect(bridge.setBottomBarColor).toHaveBeenCalledWith("#121116");
    stop();
  });

  it("lets an explicit shared preference override Telegram's device theme", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "light");
    const bridge = createBridge("dark");

    expect(initialTelegramAppearance(bridge)).toBe("light");

    const stop = startTelegramChromeAppearanceSync(bridge);
    expect(bridge.setHeaderColor).toHaveBeenCalledWith("#f3f8fc");
    stop();
  });

  it("mirrors runtime changes from the shared resolved document projection", async () => {
    const bridge = createBridge("light");
    const stop = startTelegramChromeAppearanceSync(bridge);

    document.documentElement.setAttribute(APPEARANCE_ATTRIBUTE, "dark");

    await vi.waitFor(() =>
      expect(bridge.setHeaderColor).toHaveBeenLastCalledWith("#121116"),
    );
    expect(bridge.setBackgroundColor).toHaveBeenLastCalledWith("#121116");
    expect(bridge.setBottomBarColor).toHaveBeenLastCalledWith("#121116");
    stop();
  });

  it("does nothing outside a Telegram bridge", () => {
    expect(() => startTelegramChromeAppearanceSync(undefined)).not.toThrow();
  });
});
