// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { UNSUPPORTED_GEOLOCATION } from "@nilx-one/host-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createTelegramHost,
  resolveTelegramWebApp,
  syncTelegramChrome,
  telegramLanguageTags,
  type TelegramWebAppBridge,
} from "./index";

function createBridge(): TelegramWebAppBridge {
  return {
    initData: "signed-by-telegram-but-not-yet-verified",
    initDataUnsafe: {
      user: { language_code: "uk-UA" },
    },
    colorScheme: "dark",
    safeAreaInset: { top: 12, bottom: 7 },
    HapticFeedback: {
      impactOccurred: vi.fn(),
    },
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

describe("TelegramHost", () => {
  it("marks initData as requiring server-side verification", () => {
    const host = createTelegramHost(createBridge());

    expect(host.getSnapshot()).toEqual({
      kind: "telegram",
      available: true,
      theme: "dark",
      safeArea: { top: 12, right: 0, bottom: 7, left: 0 },
      authentication: {
        kind: "telegram-init-data",
        initData: "signed-by-telegram-but-not-yet-verified",
        verification: "required",
      },
    });
  });

  it("uses an explicit unavailable host projection outside Telegram", () => {
    expect(createTelegramHost().getSnapshot()).toEqual({
      kind: "telegram",
      available: false,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: {
        kind: "telegram-init-data",
        initData: "",
        verification: "required",
      },
    });
  });

  it("performs only the Telegram host readiness handshake", () => {
    const bridge = createBridge();
    const host = createTelegramHost(bridge);

    host.ready();
    expect(bridge.ready).toHaveBeenCalledOnce();
    expect(bridge.expand).toHaveBeenCalledOnce();
  });

  it("resolves only a structurally compatible Telegram bridge", () => {
    const bridge = createBridge();

    expect(resolveTelegramWebApp({ Telegram: { WebApp: bridge } })).toBe(
      bridge,
    );
    expect(resolveTelegramWebApp({ Telegram: {} })).toBeUndefined();
    expect(resolveTelegramWebApp(undefined)).toBeUndefined();
  });

  it("projects Telegram account language only as presentation evidence", () => {
    expect(telegramLanguageTags(createBridge())).toEqual(["uk-UA"]);
    expect(
      telegramLanguageTags({
        ...createBridge(),
        initDataUnsafe: { user: { language_code: "  uk-RU  " } },
      }),
    ).toEqual(["uk-RU"]);

    const { initDataUnsafe: _ignored, ...bridgeWithoutUnsafeData } =
      createBridge();
    expect(telegramLanguageTags(bridgeWithoutUnsafeData)).toEqual([]);
  });
});

describe("TelegramHost geolocation", () => {
  it("exposes the composed embedded-browser capability unchanged", async () => {
    const geolocation = {
      readPermission: vi.fn(async () => "granted" as const),
      requestPosition: vi.fn(async () => ({
        kind: "failed" as const,
        reason: "timeout" as const,
      })),
      watchPosition: vi.fn(() => () => undefined),
    };

    const host = createTelegramHost(createBridge(), { geolocation });

    expect(host.geolocation).toBe(geolocation);
    await expect(host.geolocation.readPermission()).resolves.toBe("granted");
  });

  it("answers unsupported when the composition provides no capability", () => {
    expect(createTelegramHost(createBridge()).geolocation).toBe(
      UNSUPPORTED_GEOLOCATION,
    );
  });
});

describe("Telegram chrome appearance", () => {
  it.each([
    ["light" as const, "#f3f8fc"],
    ["dark" as const, "#121116"],
  ])("paints every supported host surface for %s appearance", (appearance, color) => {
    const bridge = createBridge();

    syncTelegramChrome(bridge, appearance);

    expect(bridge.setHeaderColor).toHaveBeenCalledWith(color);
    expect(bridge.setBackgroundColor).toHaveBeenCalledWith(color);
    expect(bridge.setBottomBarColor).toHaveBeenCalledWith(color);
  });

  it("degrades to a no-op when Telegram exposes no chrome setters", () => {
    const bridge = createBridge();
    delete bridge.setHeaderColor;
    delete bridge.setBackgroundColor;
    delete bridge.setBottomBarColor;

    expect(() => syncTelegramChrome(bridge, "dark")).not.toThrow();
    expect(() => syncTelegramChrome(undefined, "light")).not.toThrow();
  });

  it("keeps independent host capabilities isolated when one setter rejects", () => {
    const bridge = createBridge();
    bridge.setHeaderColor = vi.fn(() => {
      throw new Error("unsupported header color");
    });

    expect(() => syncTelegramChrome(bridge, "dark")).not.toThrow();
    expect(bridge.setBackgroundColor).toHaveBeenCalledWith("#121116");
    expect(bridge.setBottomBarColor).toHaveBeenCalledWith("#121116");
  });
});
