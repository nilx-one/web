// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from "vitest";

import { hasSeedsWalletAccess, parseSeedsWalletRead } from "./seeds-wallet";

describe("parseSeedsWalletRead", () => {
  it("reads Identity's exact decimal balance", () => {
    expect(
      parseSeedsWalletRead({
        balance: "9360",
        denomination: "seeds",
        symbol: "₴€£",
        authority: "identity",
      }),
    ).toEqual({ balance: 9360n });
    expect(
      parseSeedsWalletRead({
        balance: "90071992547409930",
        denomination: "seeds",
        authority: "identity",
      }),
    ).toEqual({ balance: 90071992547409930n });
  });

  it.each([
    undefined,
    null,
    [],
    { balance: 9360, denomination: "seeds", authority: "identity" },
    { balance: "-1", denomination: "seeds", authority: "identity" },
    { balance: "01", denomination: "seeds", authority: "identity" },
    { balance: "1.5", denomination: "seeds", authority: "identity" },
    { balance: "10", denomination: "usdt", authority: "identity" },
    { balance: "10", denomination: "seeds", authority: "browser" },
    { balance: "10", denomination: "seeds" },
  ])("refuses %j", (body) => {
    expect(parseSeedsWalletRead(body)).toBeUndefined();
  });
});

it("recognises a wallet port only by its read", () => {
  expect(hasSeedsWalletAccess({ readSeedsWallet: async () => undefined })).toBe(
    true,
  );
  expect(hasSeedsWalletAccess({})).toBe(false);
  expect(hasSeedsWalletAccess(undefined)).toBe(false);
});
