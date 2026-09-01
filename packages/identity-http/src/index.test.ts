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
