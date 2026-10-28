// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";
import { createIdentityHttpAdapter } from "./index";

function setup(response: () => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(response);
  return {
    adapter: createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed-data",
    }),
    fetch,
  };
}

describe("Organizations Identity transport", () => {
  it("reads only the server's authenticated membership projection", async () => {
    const { adapter, fetch } = setup(
      async () =>
        new Response(
          JSON.stringify({
            organizations: [
              { pub_dress: "0xda-market", role: "owner", created_at: 100 },
            ],
          }),
          { status: 200 },
        ),
    );
    await expect(adapter.readOrganizations()).resolves.toEqual({
      kind: "available",
      organizations: [
        { pubDress: "0xda-market", role: "owner", createdAt: 100 },
      ],
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/organizations", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: "tma signed-data" },
    });
  });

  it("refuses malformed and unauthorized responses without trusting local roles", async () => {
    const invalid = setup(
      async () =>
        new Response(
          JSON.stringify({
            organizations: [
              {
                pub_dress: "0xda-market",
                role: "super_admin",
                created_at: 100,
              },
            ],
          }),
          { status: 200 },
        ),
    );
    await expect(invalid.adapter.readOrganizations()).resolves.toEqual({
      kind: "service-unavailable",
    });
    const unauthorized = setup(async () => new Response("", { status: 401 }));
    await expect(unauthorized.adapter.readOrganizations()).resolves.toEqual({
      kind: "authentication-required",
    });
  });

  it("creates using the same origin, signed host and CSRF, never a creator field", async () => {
    const { adapter, fetch } = setup(
      async () =>
        new Response(
          JSON.stringify({
            pub_dress: "0xda-market",
            role: "owner",
            outcome: "created",
          }),
          { status: 201 },
        ),
    );
    await expect(
      adapter.createOrganization("0xda-market", "owner"),
    ).resolves.toEqual({
      kind: "created",
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/organizations", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        authorization: "tma signed-data",
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: "0xda-market", creator_role: "owner" }),
    });
  });
});
