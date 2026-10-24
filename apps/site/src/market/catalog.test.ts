// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";
import { createNilxOneMarketCatalog } from "./catalog";

const catalog = {
  meta: {
    complete: true,
    pagination: "client",
    snapshot_id: "2026-test",
    schema_version: 1,
    generated_at: "2026-10-24T00:00:00Z",
    currency: "USDT",
    locale: "en_US",
  },
  data: [
    {
      type: "product",
      id: "special",
      attributes: {
        name: "Special subscription",
        button_label: "Special",
        metadata: { category: "0x1" },
        price: { amount: "50", currency: "USDT" },
      },
    },
    {
      type: "product",
      id: "telegram-premium",
      attributes: {
        name: "Telegram Premium",
        metadata: { category: "telegram_premium" },
        price: { amount: "5", currency: "USDT" },
      },
    },
    {
      type: "product",
      id: "exclusive",
      attributes: {
        name: "Exclusive",
        metadata: { category: "0x1" },
        price: null,
      },
    },
  ],
};

describe("0x1 embedded catalog", () => {
  it("reuses the shared engine and excludes every other market category", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(catalog)));
    const products = await createNilxOneMarketCatalog(request).load("en_US");
    expect(products).toEqual([
      { id: "special", name: "Special", price: "50 USDT" },
      { id: "exclusive", name: "Exclusive", price: null },
    ]);
    expect(request).toHaveBeenCalledWith(
      "/market-api/bootstrap?locale=en_US",
      expect.objectContaining({ method: "GET", credentials: "omit" }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("renders no unrelated products when 0x1 is missing", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...catalog, data: [catalog.data[1]] })),
      );
    await expect(
      createNilxOneMarketCatalog(request).load("uk-UA"),
    ).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith(
      "/market-api/bootstrap?locale=uk_UA",
      expect.any(Object),
    );
  });

  it("does not silently fabricate products on transport failure", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream unavailable", { status: 503 }));
    await expect(
      createNilxOneMarketCatalog(request).load("en"),
    ).rejects.toThrow("Catalog unavailable");
  });
});
