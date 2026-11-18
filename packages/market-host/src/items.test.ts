// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { expect, it, vi } from "vitest";
import { createNilxOneMarketCatalog } from "./catalog";
import { SpecialStillRunning } from "@nilx-one/product-app/business";
import { changePaidItem, readPaidItems } from "./items";

it("keeps older Identity deployments usable without bypassing an unavailable authority", async () => {
  const local = vi.fn(async () => ({ ok: false as const, error: "no_room" }));
  const core = { applyInventoryCommand: local };
  const old = createNilxOneMarketCatalog(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 404 })),
    { core },
  );
  expect(await old.items!()).toEqual([]);
  expect(await old.inventoryCommand!("", { op: "normalize" }, 123)).toEqual({
    ok: false,
    error: "no_room",
  });
  expect(local).toHaveBeenCalledWith("", { op: "normalize" }, 123);
  local.mockClear();
  const down = createNilxOneMarketCatalog(
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("{}", { status: 503 })),
    { core },
  );
  await expect(
    down.inventoryCommand!("", { op: "normalize" }),
  ).rejects.toThrow();
  expect(local).not.toHaveBeenCalled();
});

it("invalidates the shared subscription source after a confirmed item action", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  const catalog = createNilxOneMarketCatalog(request);
  const invalidate = vi.fn();
  const stop = catalog.subscriptions!.subscribe("0x0sky", invalidate);
  await catalog.changeItem!("paid-order-123", { op: "activate" });
  expect(invalidate).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith(
    "/api/v1/identity/special-items/paid-order-123",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "x-0x1-csrf": "1" }),
    }),
  );
  stop();
});

it("refuses malformed reserved geometry", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [
          {
            order_id: "paid-order-123",
            sku: "0x1_special_1m",
            state: "stored",
            slot_x: -1,
            slot_y: 0,
          },
        ],
      }),
    ),
  );
  await expect(readPaidItems(undefined, request)).rejects.toThrow(
    "Invalid paid inventory",
  );
});

it("reports a Special that is still running instead of a failed activation", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "special_active", message: "…" },
        special_remaining_ms: 7_200_000,
      }),
      { status: 409 },
    ),
  );
  const error = await changePaidItem(
    "order-item1",
    { op: "activate" },
    undefined,
    request,
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(SpecialStillRunning);
  expect((error as SpecialStillRunning).remainingMs).toBe(7_200_000);
  request.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "item_not_available" } }), {
      status: 409,
    }),
  );
  const other = await changePaidItem(
    "order-item1",
    { op: "activate" },
    undefined,
    request,
  ).catch((caught: unknown) => caught);
  expect(other).not.toBeInstanceOf(SpecialStillRunning);
  expect(other).toBeInstanceOf(Error);
});
