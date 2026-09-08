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

describe("Avaia profile HTTP capability", () => {
  it("reads the persisted profile with the existing authorization proof", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "0x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "unconfigured",
        model_ref: null,
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma proof",
    });

    await expect(adapter.readAvaiaProfile()).resolves.toEqual({
      kind: "available",
      profile: {
        pubDress: "0x0skai",
        ownerPubDress: "0x0sky",
        configurationState: "unconfigured",
        modelRef: null,
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: "tma proof" },
    });
  });

  it("saves the full address with CSRF and returns the service projection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "0x0aurorai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        model_ref: null,
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.updateAvaiaProfile("0x0aurorai")).resolves.toEqual({
      kind: "updated",
      profile: {
        pubDress: "0x0aurorai",
        ownerPubDress: "0x0sky",
        configurationState: "configured",
        modelRef: null,
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ pub_dress: "0x0aurorai" }),
    });
  });

  it("keeps canonical and ownership failures distinct", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(422, { error: { code: "invalid_avaia_pub_dress" } }),
      )
      .mockResolvedValueOnce(
        response(422, {
          error: { code: "avaia_owner_discriminator_mismatch" },
        }),
      )
      .mockResolvedValueOnce(
        response(409, { error: { code: "avaia_unavailable" } }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.updateAvaiaProfile("not-an-avaia")).resolves.toEqual({
      kind: "rejected",
      reason: "invalid-address",
    });
    await expect(adapter.updateAvaiaProfile("0x1skai")).resolves.toEqual({
      kind: "rejected",
      reason: "owner-discriminator-mismatch",
    });
    await expect(adapter.updateAvaiaProfile("0x0takenai")).resolves.toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
  });
});
