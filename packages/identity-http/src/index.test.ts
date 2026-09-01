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
  it("never calls the identity API without provider authorization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.read()).resolves.toEqual({
      kind: "authentication-required",
    });
    await expect(
      adapter.checkAvailability({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    await expect(
      adapter.register({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks exact case-sensitive availability without caching the result", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(200, { pub_dress: "0xaSky", available: true }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });

    await expect(
      adapter.checkAvailability({ discriminator: "a", slug: "Sky" }),
    ).resolves.toEqual({ kind: "available" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/identity/availability?discriminator=a&slug=Sky",
      {
        cache: "no-store",
        headers: { authorization: "tma signed" },
      },
    );
  });

  it("keeps occupied and invalid candidates distinct", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(200, { pub_dress: "0x0sky", available: false }),
      )
      .mockResolvedValueOnce(
        response(422, { error: { code: "invalid_pub_dress_character" } }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });

    await expect(
      adapter.checkAvailability({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      adapter.checkAvailability({ discriminator: "0", slug: "sky space" }),
    ).resolves.toEqual({ kind: "rejected", reason: "invalid-character" });
  });

  it("passes the exact slug and provider authorization to the server boundary", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(201, {
        outcome: "registered",
        identity: { pub_dress: "0x0sky" },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "discord access-token",
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
          authorization: "discord access-token",
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
      getAuthorization: () => "tma signed",
    });

    await expect(
      adapter.register({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
  });
});
