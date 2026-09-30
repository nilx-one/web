// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createBrowserHaptics } from "./haptics";

describe("browser haptics", () => {
  it("pulses the Vibration API where a browser has one", () => {
    const vibrate = vi.fn(() => true);
    createBrowserHaptics({ vibrate, document })("medium");
    expect(vibrate).toHaveBeenCalledWith(14);
  });

  it("flips a transient native switch otherwise, and leaves nothing behind", () => {
    const clicks = vi.fn();
    document.addEventListener("click", clicks);
    createBrowserHaptics({ document })("light");
    document.removeEventListener("click", clicks);

    expect(clicks).toHaveBeenCalled();
    expect(document.querySelector("input[switch]")).toBeNull();
  });

  it("is a quiet no-op where neither exists or the pulse throws", () => {
    expect(() => createBrowserHaptics({})("heavy")).not.toThrow();
    expect(() =>
      createBrowserHaptics({
        vibrate: () => {
          throw new Error("refused");
        },
      })("light"),
    ).not.toThrow();
  });
});
