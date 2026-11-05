// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CarriedGrid } from "../inventory/inventory";
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
  const items = vi
    .fn()
    .mockResolvedValue([
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
  act(() => hook.result.current.arrive(id));
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
  act(() => hook.result.current.arrive(id));
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
  await act(async () => {
    hook.result.current.activate(id);
  });
  expect(catalog.changeItem).toHaveBeenCalledWith(id, { op: "activate" });
  expect(deliver).not.toHaveBeenCalled();
});
