// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  createTelegramHost,
  resolveTelegramWebApp,
  type TelegramWebAppBridge,
} from "./index";

function createBridge(): TelegramWebAppBridge {
  return {
    initData: "signed-by-telegram-but-not-yet-verified",
    colorScheme: "dark",
    safeAreaInset: { top: 12, bottom: 7 },
    HapticFeedback: {
      impactOccurred: vi.fn(),
    },
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
});
