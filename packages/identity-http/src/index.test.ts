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
  it("resolves exact addresses publicly without inventing availability", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "0xaSky",
        state: "registered",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(
      adapter.resolvePubDress({ discriminator: "a", slug: "Sky" }),
    ).resolves.toEqual({ kind: "registered", pubDress: "0xaSky" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/resolve", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pub_dress: "0xaSky" }),
    });
  });

  it("reads anonymous, remembered, and authenticated browser context", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(200, { state: "anonymous" }))
      .mockResolvedValueOnce(
        response(200, {
          state: "remembered",
          remembered_pub_dress: "0x0sky",
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          state: "authenticated",
          identity: { pub_dress: "0x0sky" },
        }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readNativeContext()).resolves.toEqual({
      kind: "anonymous",
    });
    await expect(adapter.readNativeContext()).resolves.toEqual({
      kind: "remembered",
      pubDress: "0x0sky",
    });
    await expect(adapter.readNativeContext()).resolves.toEqual({
      kind: "authenticated",
      identity: { pubDress: "0x0sky" },
    });
  });

  it("sends native passwords only in no-store request bodies", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(201, {
        state: "recovery_key_required",
        identity: { pub_dress: "0x0sky" },
        recovery_key: "0x1-rk-secret",
        challenge: "0x1c-secret",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(
      adapter.registerNative(
        "0x0sky",
        "a deliberately long password",
        "idempotency-key-0001",
      ),
    ).resolves.toEqual({
      kind: "recovery-key-required",
      identity: { pubDress: "0x0sky" },
      recoveryKey: "0x1-rk-secret",
      challenge: "0x1c-secret",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/native/registration",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "idempotency-key": "idempotency-key-0001",
        }),
        body: JSON.stringify({
          pub_dress: "0x0sky",
          password: "a deliberately long password",
        }),
      }),
    );
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("?password=");
  });

  it("maps native authentication failures without exposing credential detail", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(401, { error: { code: "invalid_native_credentials" } }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(
      adapter.authenticateNative("0x0sky", "incorrect long password"),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "invalid-credentials",
    });
  });

  it("keeps provider registration behind provider authorization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readProviderIdentity()).resolves.toEqual({
      kind: "authentication-required",
    });
    await expect(
      adapter.registerProvider({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses an explicit CSRF header for logout and remembered-Bond clearing", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.logoutNative()).resolves.toEqual({
      kind: "completed",
    });
    await expect(adapter.forgetRememberedBond()).resolves.toEqual({
      kind: "completed",
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/native/logout",
      expect.objectContaining({ headers: { "x-0x1-csrf": "1" } }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/native/remembered/forget",
      expect.objectContaining({ headers: { "x-0x1-csrf": "1" } }),
    );
  });
});

describe("pub_dress rename transport", () => {
  it("sends only the slug, with the session and CSRF protection", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(200, { pub_dress: "0x0rain", avaia_pub_dress: "x0rainai" }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.renamePubDressSlug("rain")).resolves.toEqual({
      kind: "renamed",
      identity: { pubDress: "0x0rain", avaiaPubDress: "x0rainai" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/identity/pub_dress",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ slug: "rain" }),
      }),
    );
  });

  it("carries a provider proof when the host has one", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(200, { pub_dress: "0x0rain" }));
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "discord access-1",
    });

    await adapter.renamePubDressSlug("rain");

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/identity/pub_dress",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "discord access-1" }),
      }),
    );
  });

  it("keeps the service's refusal reason", async () => {
    const refusal = (status: number, code: string) =>
      createIdentityHttpAdapter({
        fetch: vi
          .fn<typeof globalThis.fetch>()
          .mockResolvedValue(response(status, { error: { code } })),
        getAuthorization: () => undefined,
      });

    await expect(
      refusal(409, "pub_dress_unavailable").renamePubDressSlug("rain"),
    ).resolves.toEqual({ kind: "rejected", reason: "unavailable" });
    await expect(
      refusal(409, "avaia_unavailable").renamePubDressSlug("rain"),
    ).resolves.toEqual({ kind: "rejected", reason: "avaia-unavailable" });
    await expect(
      refusal(422, "invalid_pub_dress_length").renamePubDressSlug("r"),
    ).resolves.toEqual({ kind: "rejected", reason: "invalid-length" });
    await expect(
      refusal(429, "rate_limited").renamePubDressSlug("rain"),
    ).resolves.toEqual({ kind: "rejected", reason: "rate-limited" });
    await expect(
      refusal(500, "server_error").renamePubDressSlug("rain"),
    ).resolves.toEqual({ kind: "service-unavailable" });
  });
});

describe("Provider password setup transport", () => {
  it("sends only the password with verified host authorization and CSRF protection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(201, {
        state: "recovery_key_required",
        identity: { pub_dress: "0x0sky" },
        recovery_key: "rk",
        challenge: "challenge",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });
    await expect(
      adapter.setProviderPassword("telegram", "a private password"),
    ).resolves.toMatchObject({ kind: "recovery-key-required" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/telegram/password",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          authorization: "tma signed",
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ password: "a private password" }),
      }),
    );
  });
  it("presents the Discord proof to the Discord setup endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(201, {
        state: "recovery_key_required",
        identity: { pub_dress: "0x0sky" },
        recovery_key: "rk",
        challenge: "challenge",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "discord access-1",
    });
    await expect(
      adapter.setProviderPassword("discord", "a private password"),
    ).resolves.toMatchObject({ kind: "recovery-key-required" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/discord/password",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          authorization: "discord access-1",
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ password: "a private password" }),
      }),
    );
  });
  it("does not send a password without provider authentication", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });
    await expect(
      adapter.setProviderPassword("telegram", "a private password"),
    ).resolves.toEqual({ kind: "rejected", reason: "authentication-required" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains server-owned password setup state", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        response(200, { pub_dress: "0x0sky", password_required: true }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });
    await expect(adapter.readProviderIdentity()).resolves.toMatchObject({
      kind: "registered",
      passwordRequired: true,
    });
  });
});

describe("Avaia profile transport", () => {
  it("reads the stored Avaia over the session, and stores no copy of it", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "unconfigured",
        model_ref: null,
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readAvaiaProfile()).resolves.toEqual({
      kind: "available",
      profile: {
        pubDress: "x0skai",
        ownerPubDress: "0x0sky",
        configurationState: "unconfigured",
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia", {
      cache: "no-store",
      credentials: "same-origin",
      headers: {},
    });
  });

  it("carries a provider proof when the host has one", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        model_ref: null,
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma signed",
    });

    await adapter.readAvaiaProfile();
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { authorization: "tma signed" },
    });
  });

  it("sends the whole address with CSRF protection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0vesnai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        model_ref: null,
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.updateAvaiaProfile("x0vesnai")).resolves.toEqual({
      kind: "updated",
      profile: {
        pubDress: "x0vesnai",
        ownerPubDress: "0x0sky",
        configurationState: "configured",
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
      body: JSON.stringify({ pub_dress: "x0vesnai" }),
    });
  });

  it("keeps the service's refusal reason", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(401, {
          error: { code: "provider_authentication_required", message: "" },
        }),
      )
      .mockResolvedValueOnce(
        response(422, {
          error: { code: "avaia_owner_discriminator_mismatch", message: "" },
        }),
      )
      .mockResolvedValueOnce(
        response(422, { error: { code: "invalid_avaia_suffix", message: "" } }),
      )
      .mockResolvedValueOnce(
        response(409, { error: { code: "avaia_unavailable", message: "" } }),
      )
      .mockResolvedValueOnce(
        response(429, { error: { code: "rate_limited", message: "" } }),
      )
      .mockResolvedValueOnce(
        response(503, {
          error: { code: "identity_service_unavailable", message: "" },
        }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.updateAvaiaProfile("x0skai")).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    await expect(adapter.updateAvaiaProfile("x1skai")).resolves.toEqual({
      kind: "rejected",
      reason: "owner-discriminator-mismatch",
    });
    await expect(adapter.updateAvaiaProfile("0sky")).resolves.toEqual({
      kind: "rejected",
      reason: "invalid-address",
    });
    await expect(adapter.updateAvaiaProfile("x0takenai")).resolves.toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
    await expect(adapter.updateAvaiaProfile("x0skai")).resolves.toEqual({
      kind: "rejected",
      reason: "rate-limited",
    });
    await expect(adapter.updateAvaiaProfile("x0skai")).resolves.toEqual({
      kind: "service-unavailable",
    });
  });

  it("treats an unreadable projection as an unavailable service", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(200, { pub_dress: "x0skai" }))
      .mockResolvedValueOnce(
        response(401, {
          error: { code: "provider_authentication_required", message: "" },
        }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readAvaiaProfile()).resolves.toEqual({
      kind: "service-unavailable",
    });
    await expect(adapter.readAvaiaProfile()).resolves.toEqual({
      kind: "authentication-required",
    });
  });

  it("nests the published location's coordinate under the read profile", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        model_ref: null,
        location: {
          coordinate: { longitude_e7: "305234000", latitude_e7: "504501000" },
        },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readAvaiaProfile()).resolves.toEqual({
      kind: "available",
      profile: {
        pubDress: "x0skai",
        ownerPubDress: "0x0sky",
        configurationState: "configured",
        location: { coordinate: { longitude: 30.5234, latitude: 50.4501 } },
      },
    });
  });

  it("publishes the owner's chosen position with CSRF protection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        pub_dress: "x0skai",
        owner_pub_dress: "0x0sky",
        configuration_state: "configured",
        model_ref: null,
        location: {
          coordinate: { longitude_e7: "305234000", latitude_e7: "504501000" },
        },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(
      adapter.publishAvaiaLocation({ longitude: 30.5234, latitude: 50.4501 }),
    ).resolves.toEqual({
      kind: "published",
      profile: {
        pubDress: "x0skai",
        ownerPubDress: "0x0sky",
        configurationState: "configured",
        location: { coordinate: { longitude: 30.5234, latitude: 50.4501 } },
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/identity/avaia/location", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        "x-0x1-csrf": "1",
      },
      body: JSON.stringify({ longitude: 30.5234, latitude: 50.4501 }),
    });
  });

  it("keeps the service's location refusal reason", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response(401, {
          error: { code: "provider_authentication_required", message: "" },
        }),
      )
      .mockResolvedValueOnce(
        response(422, {
          error: { code: "invalid_avaia_location", message: "" },
        }),
      )
      .mockResolvedValueOnce(
        response(429, { error: { code: "rate_limited", message: "" } }),
      )
      .mockResolvedValueOnce(
        response(503, {
          error: { code: "identity_service_unavailable", message: "" },
        }),
      );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });
    const position = { longitude: 30.5234, latitude: 50.4501 };

    await expect(adapter.publishAvaiaLocation(position)).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    await expect(adapter.publishAvaiaLocation(position)).resolves.toEqual({
      kind: "rejected",
      reason: "invalid-location",
    });
    await expect(adapter.publishAvaiaLocation(position)).resolves.toEqual({
      kind: "rejected",
      reason: "rate-limited",
    });
    await expect(adapter.publishAvaiaLocation(position)).resolves.toEqual({
      kind: "service-unavailable",
    });
  });
});

describe("Browser provider connection transport", () => {
  it("reads canonical provider bindings from the authenticated service", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "available",
        providers: ["telegram", "github"],
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readBrowserProviderConnections?.()).resolves.toEqual({
      kind: "available",
      connections: [{ provider: "telegram" }, { provider: "github" }],
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/browser/provider/connections",
      {
        cache: "no-store",
        credentials: "same-origin",
      },
    );
  });

  it("disconnects only the selected provider binding with CSRF protection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "disconnected",
        provider: "github",
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(
      adapter.disconnectBrowserProvider?.("github"),
    ).resolves.toEqual({
      kind: "disconnected",
      provider: "github",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/browser/provider/disconnect",
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-0x1-csrf": "1",
        },
        body: JSON.stringify({ provider: "github" }),
      },
    );
  });

  it("rejects malformed provider lists instead of inventing connection truth", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(200, {
        state: "available",
        providers: ["github", "matrix"],
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.readBrowserProviderConnections?.()).resolves.toEqual({
      kind: "service-unavailable",
    });
  });
});

describe("Telegram self-disconnect transport", () => {
  it("disconnects the identity that authenticated the request, naming no provider", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(200, { state: "disconnected" }));
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma init-data",
    });

    await expect(adapter.disconnectSelfProvider?.()).resolves.toEqual({
      kind: "disconnected",
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/telegram/disconnect", {
      method: "POST",
      cache: "no-store",
      headers: { authorization: "tma init-data" },
    });
  });

  it("never calls the service without provider proof to authenticate with", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => undefined,
    });

    await expect(adapter.disconnectSelfProvider?.()).resolves.toEqual({
      kind: "rejected",
      reason: "authentication-required",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses when disconnecting would leave the Bond with no way back in", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response(409, {
        error: { code: "sole_access_path", message: "" },
      }),
    );
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma init-data",
    });

    await expect(adapter.disconnectSelfProvider?.()).resolves.toEqual({
      kind: "rejected",
      reason: "sole-access-path",
    });
  });

  it("reports not-connected when this identity carries no Bond", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(404, {}));
    const adapter = createIdentityHttpAdapter({
      fetch,
      getAuthorization: () => "tma init-data",
    });

    await expect(adapter.disconnectSelfProvider?.()).resolves.toEqual({
      kind: "rejected",
      reason: "not-connected",
    });
  });
});
