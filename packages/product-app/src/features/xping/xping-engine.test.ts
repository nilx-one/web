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

const { repairXping, useXpingEngine } = await import("./xping-engine");
const { act, renderHook, waitFor } = await import("@testing-library/react");

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

describe("useXpingEngine repairs", () => {
  it("counts only repairs Identity confirmed, not engine reads", async () => {
    const repaired = {
      ...BROKEN,
      state: { energy_permille: 1000, at_ms: "9000" },
    };
    const port = engine({ kind: "read", ...repaired });
    port.repairXpingEngine
      .mockResolvedValueOnce({ kind: "read", ...repaired })
      .mockResolvedValueOnce({ kind: "rejected", reason: "not_enough_seeds" });
    const { result } = renderHook(() =>
      useXpingEngine("0x0sky", port, undefined),
    );
    await waitFor(() => expect(result.current.read).toBeDefined());
    expect(result.current.repairs).toBe(0);

    act(() => result.current.repair());
    await waitFor(() => expect(result.current.repairs).toBe(1));
    await waitFor(() => expect(result.current.busy).toBe(false));

    // A refused repair debits nothing, so the wallet need not be read again.
    act(() => result.current.repair());
    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.repairs).toBe(1);
  });
});
