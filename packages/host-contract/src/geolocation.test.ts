// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { UNSUPPORTED_GEOLOCATION } from "./geolocation";

describe("UNSUPPORTED_GEOLOCATION", () => {
  it("answers the canonical contract instead of forcing a host branch", async () => {
    await expect(UNSUPPORTED_GEOLOCATION.readPermission()).resolves.toBe(
      "unsupported",
    );
    await expect(UNSUPPORTED_GEOLOCATION.requestPosition()).resolves.toEqual({
      kind: "failed",
      reason: "unsupported",
    });
  });

  it("tells a subscriber the capability is absent and stops cleanly", () => {
    const observed = vi.fn();

    const stop = UNSUPPORTED_GEOLOCATION.watchPosition(observed);
    stop();
    stop();

    expect(observed).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      reason: "unsupported",
    });
  });
});
