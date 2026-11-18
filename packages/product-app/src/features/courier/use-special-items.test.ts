// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CarriedGrid } from "../inventory/inventory";
import { SpecialStillRunning } from "./market-dock";
import { useSpecialItems } from "./use-special-items";

const { deliver } = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock("../inventory/inventory", () => ({ deliverToInventory: deliver }));
const id = "paid-order-123";
const bag: CarriedGrid = {
  carry: "backpack",
  things: [{ id: "can", x: 2, y: 0 }],
  owned: ["backpack"],
};
beforeEach(() => {
  deliver.mockReset();
  deliver.mockImplementation(
    async (_owner: string, callback: (grid: CarriedGrid) => Promise<void>) =>
      callback(bag),
  );
});

it("delivers the committed grid and refreshes the stored item", async () => {
  const items = vi.fn().mockResolvedValue([
    {
      order_id: id,
      sku: "0x1_special_1m",
      state: "in_transit",
      slot_x: null,
      slot_y: null,
    },
  ]);
  const changeItem = vi.fn(async () => {
    items.mockResolvedValue([
      {
        order_id: id,
        sku: "0x1_special_1m",
        state: "stored",
        slot_x: 0,
        slot_y: 0,
      },
    ]);
  });
  const catalog = { load: vi.fn(), items, changeItem };
  const hook = renderHook(() => useSpecialItems("0x0sky", catalog, id));
  await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
  let delivered: boolean | undefined;
  await act(async () => {
    delivered = await hook.result.current.arrive(id);
  });
  expect(delivered).toBe(true);
  await waitFor(() =>
    expect(hook.result.current.items[0]?.state).toBe("stored"),
  );
  expect(changeItem).toHaveBeenCalledWith(id, {
    op: "deliver",
    carry: "backpack",
    things: bag.things,
  });
});

it("keeps a failed delivery retryable without inventing an empty inventory", async () => {
  deliver.mockRejectedValueOnce(new Error("corrupt journal"));
  const catalog = {
    load: vi.fn(),
    items: vi.fn(async () => []),
    changeItem: vi.fn(async () => {}),
  };
  const hook = renderHook(() => useSpecialItems("0x0sky", catalog, id));
  await act(async () => {
    await Promise.resolve();
  });
  let delivered: boolean | undefined;
  await act(async () => {
    delivered = await hook.result.current.arrive(id);
  });
  // Nothing was delivered, so nothing is asked about it.
  expect(delivered).toBe(false);
  await waitFor(() => expect(hook.result.current.retry).toBeTypeOf("function"));
  expect(catalog.changeItem).not.toHaveBeenCalled();
  act(() => hook.result.current.retry?.());
  await waitFor(() =>
    expect(catalog.changeItem).toHaveBeenCalledWith(id, {
      op: "deliver",
      carry: "backpack",
      things: bag.things,
    }),
  );
});

it("activates without starting another delivery", async () => {
  const catalog = {
    load: vi.fn(),
    items: vi.fn(async () => []),
    changeItem: vi.fn(async () => {}),
  };
  const hook = renderHook(() => useSpecialItems("0x0sky", catalog, id));
  let activated: boolean | undefined;
  await act(async () => {
    activated = await hook.result.current.activate(id);
  });
  expect(activated).toBe(true);
  expect(catalog.changeItem).toHaveBeenCalledWith(id, { op: "activate" });
  expect(deliver).not.toHaveBeenCalled();
});

it("asks before adding a term to a Special that still runs, then extends on yes", async () => {
  const changeItem = vi
    .fn<(id: string, command: unknown) => Promise<void>>()
    .mockRejectedValueOnce(new SpecialStillRunning(3 * 86_400_000))
    .mockResolvedValue(undefined);
  const catalog = {
    load: vi.fn(),
    items: vi.fn(async () => []),
    changeItem,
  };
  const hook = renderHook(() => useSpecialItems("0x0sky", catalog, id));
  let activated: boolean | undefined;
  await act(async () => {
    activated = await hook.result.current.activate(id);
  });
  // Not a failure to retry: a question, and nothing was spent.
  expect(activated).toBe(false);
  expect(hook.result.current.retry).toBeUndefined();
  expect(hook.result.current.confirmation).toEqual({
    id,
    remainingMs: 3 * 86_400_000,
  });
  await act(async () => {
    activated = await hook.result.current.confirm();
  });
  expect(activated).toBe(true);
  expect(changeItem).toHaveBeenLastCalledWith(id, {
    op: "activate",
    confirm: true,
  });
  expect(hook.result.current.confirmation).toBeUndefined();
});

it("keeps the item for later when the person declines the extension", async () => {
  const catalog = {
    load: vi.fn(),
    items: vi.fn(async () => []),
    changeItem: vi.fn(async () => {
      throw new SpecialStillRunning(7_200_000);
    }),
  };
  const hook = renderHook(() => useSpecialItems("0x0sky", catalog, id));
  await act(async () => {
    await hook.result.current.activate(id);
  });
  act(() => hook.result.current.keepForLater());
  expect(hook.result.current.confirmation).toBeUndefined();
  expect(catalog.changeItem).toHaveBeenCalledOnce();
});
