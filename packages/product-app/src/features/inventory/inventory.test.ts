// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreInventoryAnswer } from "@nilx-one/application";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InventoryRecord } from "../progression/committed-journal";

let stored: InventoryRecord = { state: "", pickedUp: new Set() };

vi.mock("../progression/committed-journal", () => ({
  updateInventory: async (
    _owner: string,
    change: (
      current: InventoryRecord,
    ) => Promise<{ state: string; pickedUp?: string } | undefined>,
  ) => {
    const next = await change(stored);
    if (next === undefined) return false;
    stored = {
      state: next.state,
      pickedUp: new Set([
        ...stored.pickedUp,
        ...(next.pickedUp === undefined ? [] : [next.pickedUp]),
      ]),
    };
    return true;
  },
  readCommittedJournal: vi.fn(),
  subscribeCommittedJournal: vi.fn(),
}));

const { EMPTY_INVENTORY, applyInventory, pickUpFind, readInventoryModel } =
  await import("./inventory");

const STATE =
  '{"avaia":{"carry":"pocket","things":[]},"bond":{"carry":"backpack","things":[{"id":"can","x":0,"y":0}]},"craft":{"ready_ms":"2701000","recipe":"repair_cd_player","started_ms":"1000"},"seeds":"15"}';

function core(answer: CoreInventoryAnswer) {
  return {
    applyInventoryCommand: vi.fn(async () => answer),
    economyCatalog: vi.fn(),
  };
}

beforeEach(() => {
  stored = { state: "", pickedUp: new Set() };
});

describe("readInventoryModel", () => {
  it("reads Core's stored inventory for the screen", () => {
    expect(readInventoryModel(STATE)).toEqual({
      seeds: 15,
      bond: {
        carry: "backpack",
        things: [{ id: "can", x: 0, y: 0 }],
        owned: ["pocket", "backpack"],
      },
      avaia: { carry: "pocket", things: [], owned: ["pocket"] },
      craft: { recipe: "repair_cd_player", startedMs: 1000, readyMs: 2701000 },
      gifted: true,
    });
  });

  it("shows a new or unreadable inventory as empty", () => {
    expect(readInventoryModel("")).toBe(EMPTY_INVENTORY);
    expect(readInventoryModel("{")).toBe(EMPTY_INVENTORY);
    expect(readInventoryModel('{"seeds":"-1"}')).toBe(EMPTY_INVENTORY);
  });
});

describe("reading what each owns", () => {
  it("takes what Core stored, and counts an old backpack as the gift", () => {
    const model = readInventoryModel(
      '{"avaia":{"carry":"pocket","things":[]},"bond":{"carry":"pocket","things":[]},"craft":null,"gifted":false,"owned":{"avaia":["pocket","bag"],"bond":["pocket"]},"seeds":"0"}',
    );
    expect(model.avaia.owned).toEqual(["pocket", "bag"]);
    expect(model.gifted).toBe(false);
    expect(EMPTY_INVENTORY.bond.carry).toBe("pocket");
  });
});

describe("pickUpFind", () => {
  const find = { artifactId: "art:x", tier: 1, holder: "avaia" } as const;
  const kept: CoreInventoryAnswer = {
    ok: true,
    state: STATE,
    seedsGained: 0,
    seedsSpent: 0,
    experience: 0,
    item: "can",
  };

  it("puts a kept find in once, however often it is kept", async () => {
    const port = core(kept);
    await expect(pickUpFind("0x0sky", port, find, () => 7)).resolves.toEqual(
      kept,
    );
    expect(port.applyInventoryCommand).toHaveBeenCalledWith(
      "",
      { op: "pick_up", holder: "avaia", artifact_id: "art:x", tier: 1 },
      7,
    );
    expect(stored.state).toBe(STATE);

    await expect(pickUpFind("0x0sky", port, find)).resolves.toBe("already-in");
    expect(port.applyInventoryCommand).toHaveBeenCalledTimes(1);
  });

  it("leaves a find that fits nowhere out, so it can still go in later", async () => {
    const full = core({ ok: false, error: "no_room" });
    await expect(pickUpFind("0x0sky", full, find)).resolves.toEqual({
      ok: false,
      error: "no_room",
    });
    expect(stored.pickedUp.has("art:x")).toBe(false);
  });

  it("answers unavailable without Core's inventory", async () => {
    await expect(
      pickUpFind("0x0sky", { economyCatalog: vi.fn() }, find),
    ).resolves.toEqual({ ok: false, error: "unavailable" });
  });
});

describe("applyInventory", () => {
  it("keeps the old state when Core refuses", async () => {
    stored = { state: STATE, pickedUp: new Set() };
    const refused = core({ ok: false, error: "not_for_sale" });
    await expect(
      applyInventory("0x0sky", refused, { op: "sell", id: "flyer", count: 1 }),
    ).resolves.toEqual({ ok: false, error: "not_for_sale" });
    expect(stored.state).toBe(STATE);
  });
});
