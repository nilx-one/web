// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";

const applyInventory = vi.fn(async () => ({
  ok: true as const,
  state: "{}",
  seedsGained: 0,
  seedsSpent: 0,
  experience: 0,
}));

vi.mock("./inventory", () => ({ applyInventory, useInventory: vi.fn() }));
vi.mock("../progression/committed-journal", () => ({
  readCommittedJournal: async () => ({
    inventory: { state: '{"stored":true}', pickedUp: new Set() },
  }),
}));

const { giveBackpacksIfDue } = await import("./backpack-gift");
const { GUIDE_NODES, GUIDE_OPENING, isRecordedGuideLine } =
  await import("../guide/guide-script");

beforeEach(() => applyInventory.mockClear());

describe("xSasha's backpack gift", () => {
  const core = (due: boolean) => ({
    applyInventoryCommand: vi.fn(),
    economyCatalog: vi.fn(),
    backpackGiftDue: vi.fn(async () => due),
  });

  it("is given when Core says it is due, at the Bond's level", async () => {
    const port = core(true);
    await expect(giveBackpacksIfDue("0x0sky", port, 2)).resolves.toBe(true);
    expect(port.backpackGiftDue).toHaveBeenCalledWith('{"stored":true}', 2);
    expect(applyInventory).toHaveBeenCalledWith("0x0sky", port, {
      op: "gift_backpacks",
      bond_level: 2,
    });
  });

  it("is not given before, nor without Core's answer", async () => {
    await expect(giveBackpacksIfDue("0x0sky", core(false), 1)).resolves.toBe(
      false,
    );
    await expect(
      giveBackpacksIfDue(
        "0x0sky",
        { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() },
        3,
      ),
    ).resolves.toBe(false);
    expect(applyInventory).not.toHaveBeenCalled();
  });

  it("is said in a scene of hers, typed out until it is recorded", () => {
    const gift = GUIDE_NODES[GUIDE_OPENING.backpack];
    expect(gift.reward).toBe(true);
    expect(gift.recorded).toBe(false);
    for (const wording of gift.line) {
      expect(isRecordedGuideLine(wording as string)).toBe(false);
    }
    expect(isRecordedGuideLine("guide.reward.together.0")).toBe(true);
  });
});
