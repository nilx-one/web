// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createBrowserHost, type BrowserHostEnvironment } from "./index";

function createEnvironment(matches: boolean): {
  environment: BrowserHostEnvironment;
  dispatchTheme: (matches: boolean) => void;
  open: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    addEventListener: (_event: "change", listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_event: "change", listener: () => void) => {
      listeners.delete(listener);
    },
  } as unknown as MediaQueryList;
  const open = vi.fn(() => null);

  return {
    environment: {
      matchMedia: () => media,
      open,
    },
    dispatchTheme: (nextMatches: boolean) => {
      Object.defineProperty(media, "matches", {
        configurable: true,
        value: nextMatches,
      });
      listeners.forEach((listener) => listener());
    },
    open,
  };
}

describe("BrowserHost", () => {
  it("exposes browser capabilities behind the shared contract", () => {
    const { environment } = createEnvironment(false);

    expect(createBrowserHost(environment).getSnapshot()).toEqual({
      kind: "browser",
      available: true,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: { kind: "browser-session" },
    });
  });

  it("publishes theme changes without leaking matchMedia into the product", () => {
    const { environment, dispatchTheme } = createEnvironment(false);
    const host = createBrowserHost(environment);
    const listener = vi.fn();
    const unsubscribe = host.subscribe(listener);

    dispatchTheme(true);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "dark" }),
    );

    unsubscribe();
    dispatchTheme(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("opens only HTTP external links", () => {
    const { environment, open } = createEnvironment(false);
    const host = createBrowserHost(environment);

    host.openExternal(new URL("https://nilx.one"));
    expect(open).toHaveBeenCalledWith(
      "https://nilx.one/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(() => host.openExternal(new URL("data:text/plain,unsafe"))).toThrow(
      "Unsupported external URL protocol",
    );
  });
});
