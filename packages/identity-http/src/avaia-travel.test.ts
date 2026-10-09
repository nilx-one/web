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

describe("confirmed Avaia GPS travel", () => {
  it("posts signed arrival coordinates", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        can_travel: true,
        location: {
          coordinate: {
            longitude_e7: "305234000",
            latitude_e7: "504501000",
          },
          travel_revision: "2",
        },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });
    const position = { longitude: 30.5234, latitude: 50.4501 };

    const result = await adapter.travelAvaiaToBond?.(position);
    expect(result).toMatchObject({
      kind: "arrived",
      profile: {
        canTravel: true,
        location: { travelRevision: "2" },
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia/travel", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        authorization: "tma signed",
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify(position),
    });
  });

  it("rejects non-admin travel", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(403, { error: { code: "admin_required" } }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });

    const position = { longitude: 30.5234, latitude: 50.4501 };
    const result = await adapter.travelAvaiaToBond?.(position);
    expect(result).toEqual({
      kind: "rejected",
      reason: "admin-required",
    });
  });
});
