// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { withMarketInventory } from "./market-inventory-core";

class CoreDouble {
  readonly contract = "0.1.0";
  private readonly answer = "near";

  async avaiaProximity(): Promise<string> {
    return this.answer;
  }

  async applyInventoryCommand(): Promise<string> {
    return "core";
  }
}

describe("withMarketInventory", () => {
  it("sends inventory commands to Market and everything else to Core", async () => {
    const market = vi.fn(async () => "market");
    const port = withMarketInventory(new CoreDouble(), market);

    await expect(port.applyInventoryCommand()).resolves.toBe("market");
    // Bound to Core: a method that reads its own fields still can.
    await expect(port.avaiaProximity()).resolves.toBe("near");
    expect(port.contract).toBe("0.1.0");
  });

  it("hands out the same function each time a method is read", () => {
    const port = withMarketInventory(new CoreDouble(), async () => "market");

    // An effect that depends on `core.avaiaProximity` must see one dependency
    // across renders, or it runs again on every one of them.
    expect(port.avaiaProximity).toBe(port.avaiaProximity);
    expect(port.applyInventoryCommand).toBe(port.applyInventoryCommand);
  });
});
