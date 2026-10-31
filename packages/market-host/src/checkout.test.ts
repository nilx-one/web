// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { expect, it, vi } from "vitest";
import { createMarketCheckout } from "./checkout";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

it("lists only well-formed seeds offers from the visit session", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    json({
      offers: [
        {
          sku: "0x1_special_1m",
          price_id: "p1",
          amount_minor: 400,
          denomination: "seeds",
        },
        { sku: "0x1_special_3m", price_id: "p3", amount_minor: "1000" },
        { sku: "0x1_special_6m", price_id: "p6", amount_minor: 0 },
      ],
    }),
  );
  await expect(createMarketCheckout(request).offers()).resolves.toEqual([
    { sku: "0x1_special_1m", priceId: "p1", amountMinor: 400 },
  ]);
  expect(request).toHaveBeenCalledWith(
    "/nilx-browser/offers",
    expect.objectContaining({ credentials: "same-origin", redirect: "error" }),
  );
});

it("orders with CSRF proof and sends only the SKU, price and key", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    json(
      {
        order: { id: "o1", attributes: { status: "pending" } },
        visit_id: "v".repeat(43),
      },
      201,
    ),
  );
  await expect(
    createMarketCheckout(request).order({
      sku: "0x1_special_1m",
      priceId: "p1",
      amountMinor: 400,
      idempotencyKey: "k1",
    }),
  ).resolves.toEqual({ id: "o1", status: "pending", visitId: "v".repeat(43) });
  const [path, init] = request.mock.calls[0]!;
  expect(path).toBe("/nilx-browser/orders");
  expect(init?.method).toBe("POST");
  expect(init?.headers).toMatchObject({
    "Content-Type": "application/json",
    "X-Market-Csrf": "1",
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    sku: "0x1_special_1m",
    price_id: "p1",
    amount_minor: 400,
    idempotency_key: "k1",
  });
});

it("reads a declined order and fails closed on errors or unknown states", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      json({
        order: {
          id: "o1",
          attributes: {
            status: "rejected",
            rejection_code: "insufficient_seeds",
          },
        },
      }),
    )
    .mockResolvedValueOnce(
      json({ order: { id: "o1", attributes: { status: "paid" } } }),
    )
    .mockResolvedValueOnce(json({ error: "session_required" }, 401));
  const checkout = createMarketCheckout(request);
  await expect(checkout.read("o1")).resolves.toEqual({
    id: "o1",
    status: "rejected",
    rejectionCode: "insufficient_seeds",
  });
  await expect(checkout.read("o1")).rejects.toThrow("Invalid order");
  await expect(checkout.read("o1")).rejects.toThrow("Checkout unavailable");
});
