// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreInventoryAnswer } from "@nilx-one/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applyInventory =
  vi.fn<(...args: unknown[]) => Promise<CoreInventoryAnswer>>();
const earnActivity = vi.fn(async () => undefined);

vi.mock("./inventory", () => ({ applyInventory, useInventory: vi.fn() }));
vi.mock("../progression/committed-sync", () => ({ earnActivity }));

const { finishCraft, isFinished, startCraft } = await import("./craft");
const { craftRecipeOf } = await import("../progression/commitment");

const core = { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() };
const craft = { recipe: "repair_cd_player", startedMs: 1_000, readyMs: 2_000 };

beforeEach(() => {
  applyInventory.mockReset();
  earnActivity.mockClear();
});

describe("crafting", () => {
  it("starts a recipe where the Bond stands", async () => {
    applyInventory.mockResolvedValue({ ok: false, error: "wrong_place" });
    await startCraft("0x0sky", core, { id: "repair_cd_player" } as never);
    expect(applyInventory).toHaveBeenCalledWith(
      "0x0sky",
      core,
      { op: "start_craft", recipe: "repair_cd_player", place: "anywhere" },
      undefined,
    );
  });

  it("earns the recipe's experience as the Bond's committed award once done", async () => {
    applyInventory.mockResolvedValue({
      ok: true,
      state: "{}",
      seedsGained: 0,
      seedsSpent: 200,
      experience: 50,
    });
    const result = await finishCraft("0x0sky", core, craft, true, () => 9_000);

    expect(isFinished(result) && result.experience).toBe(50);
    expect(earnActivity).toHaveBeenCalledWith(
      "0x0sky",
      {
        kind: "craft_finished",
        earner: "bond",
        subject: "craft:repair_cd_player:1000",
        at: 9_000,
      },
      true,
    );
    expect(craftRecipeOf("craft:repair_cd_player:1000")).toBe(
      "repair_cd_player",
    );
  });

  it("earns nothing for a craft Core does not finish", async () => {
    applyInventory.mockResolvedValue({ ok: false, error: "not_ready" });
    const result = await finishCraft("0x0sky", core, craft, true);
    expect(isFinished(result)).toBe(false);
    expect(earnActivity).not.toHaveBeenCalled();
  });
});
