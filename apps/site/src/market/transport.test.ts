// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";
import { catalogTransport } from "./transport";

describe("public market catalog transport", () => {
  it("reads the catalog without the app session and fails closed for all checkout operations", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: [] })));
    const transport = catalogTransport(request);
    await expect(transport.bootstrap({ locale: "uk_UA" })).resolves.toEqual({
      data: [],
    });
    expect(request).toHaveBeenCalledWith(
      "/market-api/bootstrap?locale=uk_UA",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    await expect(transport.quote()).rejects.toThrow("not connected");
    await expect(transport.acceptQuote()).rejects.toThrow("not connected");
    await expect(transport.refreshOrder()).rejects.toThrow("not connected");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects an unavailable server", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    await expect(
      catalogTransport(request).bootstrap({ locale: "en" }),
    ).rejects.toThrow("Catalog unavailable");
  });
});
