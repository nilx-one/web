// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createIdentityHttpAdapter } from "./index";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("identity HTTP adapter", () => {
  it("never calls the identity API without Telegram initData", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createIdentityHttpAdapter({
      fetch,
      getTelegramInitData: () => undefined,
    });

    await expect(adapter.read()).resolves.toEqual({
      kind: "authentication-required",
    });
    await expect(
      adapter.register({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("passes the exact slug and raw initData to the server boundary", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(201, {
        outcome: "registered",
        identity: { pub_dress: "0x0sky" },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getTelegramInitData: () => "auth_date=1&hash=abc",
    });

    await expect(
      adapter.register({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "registered",
      outcome: "created",
      identity: { pubDress: "0x0sky" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/identity/registration",
      expect.objectContaining({
        body: JSON.stringify({ discriminator: "0", slug: "sky" }),
        headers: expect.objectContaining({
          authorization: "tma auth_date=1&hash=abc",
        }),
      }),
    );
  });

  it("maps collision without exposing another provider binding", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(409, {
        error: { code: "pub_dress_unavailable" },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getTelegramInitData: () => "signed",
    });

    await expect(
      adapter.register({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
  });
});
