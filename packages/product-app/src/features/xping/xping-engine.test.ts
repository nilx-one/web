// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  XpingEngineAccessPort,
  XpingEngineRead,
  XpingEngineResult,
} from "@nilx-one/application";
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
    stored = { state: next.state, pickedUp: stored.pickedUp };
    return true;
  },
  readCommittedJournal: vi.fn(),
  subscribeCommittedJournal: vi.fn(),
}));

const { grantStarterSeeds, repairXping, resetStarterSeedsForTest } =
  await import("./xping-engine");

const BROKEN: XpingEngineRead = {
  state: { energy_permille: 0, at_ms: "1000", broken_at_ms: "1000" },
  view: {
    energyPermille: 0,
    smokePermille: 1000,
    broken: true,
    emptyMarginMs: 0,
    fullAtMs: 43_201_000,
    repairSeeds: 50,
  },
  nowMs: 5_000,
};

function engine(repaired: XpingEngineResult): XpingEngineAccessPort & {
  repairXpingEngine: ReturnType<typeof vi.fn>;
} {
  return {
    readXpingEngine: vi.fn(async () => ({ kind: "read", ...BROKEN }) as const),
    forceXpingEngine: vi.fn(),
    repairXpingEngine: vi.fn(async () => repaired),
  };
}

beforeEach(() => {
  stored = { state: '{"seeds":"100"}', pickedUp: new Set() };
  resetStarterSeedsForTest();
});

describe("repairXping", () => {
  it("asks Identity to debit and repair, never local Core inventory", async () => {
    const service = engine({ kind: "read", ...BROKEN });
    const core = {
      xpingRepair: vi.fn(),
    };
    const outcome = await repairXping("0x1sky", service, core);
    expect(outcome.kind).toBe("repaired");
    expect(service.repairXpingEngine).toHaveBeenCalledWith(BROKEN.state);
    expect(core.xpingRepair).not.toHaveBeenCalled();
    expect(stored.state).toBe('{"seeds":"100"}');
  });

  it("keeps local history untouched when Identity refuses stale or insufficient funds", async () => {
    for (const reason of ["stale", "not_enough_seeds"] as const) {
      const service = engine({ kind: "rejected", reason });
      await expect(repairXping("0x1sky", service)).resolves.toEqual({
        kind: "refused",
        reason,
      });
      expect(stored.state).toBe('{"seeds":"100"}');
    }
  });

  it("does not require a local Core repair port", async () => {
    const service = engine({ kind: "read", ...BROKEN });
    await expect(repairXping("0x1sky", service)).resolves.toMatchObject({
      kind: "repaired",
    });
  });
});

describe("grantStarterSeeds", () => {
  it("asks Core once a session per owner", async () => {
    const core = {
      applyInventoryCommand: vi.fn(async () => ({
        ok: true as const,
        state: '{"seeds":"10100","starter":true}',
        seedsGained: 10_000,
        seedsSpent: 0,
        experience: 0,
      })),
      economyCatalog: vi.fn(),
    };
    await expect(grantStarterSeeds("0x1sky", core)).resolves.toBe(true);
    await expect(grantStarterSeeds("0x1sky", core)).resolves.toBe(false);
    expect(core.applyInventoryCommand).toHaveBeenCalledOnce();
    expect(core.applyInventoryCommand).toHaveBeenCalledWith(
      '{"seeds":"100"}',
      { op: "grant_starter_seeds" },
      expect.any(Number),
    );
    expect(stored.state).toBe('{"seeds":"10100","starter":true}');
  });
});
