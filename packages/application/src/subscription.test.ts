// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import { decodeSubscriptionStatus } from "./subscription";

describe("Core subscription boundary", () => {
  it("keeps unknown distinct from confirmed absence", () => {
    expect(decodeSubscriptionStatus('{"kind":"unknown"}')).toEqual({
      kind: "unknown",
    });
    expect(
      decodeSubscriptionStatus(
        '{"kind":"none","valid_until_ms":"18446744073709551615"}',
      ),
    ).toEqual({ kind: "none", valid_until_ms: "18446744073709551615" });
  });
  it.each([
    null,
    {},
    {
      kind: "active",
      tier: "legendary",
      bond_pub_dress: "0x0sky",
      valid_until_ms: "200",
    },
    { kind: "none", valid_until_ms: 200 },
    { kind: "none", valid_until_ms: "0200" },
    { kind: "none", valid_until_ms: "18446744073709551616" },
  ])("rejects malformed runtime responses %j", (value) => {
    expect(() => decodeSubscriptionStatus(JSON.stringify(value))).toThrow();
  });
});
