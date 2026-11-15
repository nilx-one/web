// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createAisProductSessionPort } from "./ais-product-session";

const PROFILE_ID = "0123456789abcdef0123456789abcdef";

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AIS product-session transport", () => {
  it("reads public issuer configuration without a provider credential", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      answer(200, { enabled: true, issuer: "https://auth.aiaiaiai.org" }),
    );
    const client = createAisProductSessionPort({ fetch });
    expect(await client.readConfiguration()).toEqual({
      kind: "enabled",
      issuer: "https://auth.aiaiaiai.org",
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/aiaiaiai/config", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("authorization");
  });

  it("never treats a disabled or malformed issuer as enabled", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(answer(200, { enabled: false, issuer: null }))
      .mockResolvedValueOnce(
        answer(200, { enabled: true, issuer: "http://not-secure.example" }),
      )
      .mockResolvedValueOnce(answer(503, { error: "unavailable" }));
    const client = createAisProductSessionPort({ fetch });
    expect(await client.readConfiguration()).toEqual({ kind: "disabled" });
    expect(await client.readConfiguration()).toEqual({ kind: "unavailable" });
    expect(await client.readConfiguration()).toEqual({ kind: "unavailable" });
  });

  it("keeps return URLs on the current host before redirect to AIS", () => {
    const client = createAisProductSessionPort();
    expect(client.signInPath("/world?point=1")).toBe(
      "/api/v1/auth/aiaiaiai/start?return=%2Fworld%3Fpoint%3D1",
    );
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/world\nLocation: https://evil.example",
      "x",
    ]) {
      expect(client.signInPath(unsafe)).toBe(
        "/api/v1/auth/aiaiaiai/start?return=%2F",
      );
    }
  });

  it("projects a product profile, not a legacy Bond authorization", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      answer(200, {
        profile: {
          profile_id: PROFILE_ID,
          pub_dress: "0x0sky",
          experience: { authority: "client", bond_xp: 21, avaia_xp: 3 },
          issuer: "do-not-expose",
          subject: "do-not-expose",
          roles: ["gm"],
          legacy_bond_id: "do-not-expose",
        },
      }),
    );
    const client = createAisProductSessionPort({ fetch });
    expect(await client.readSession()).toEqual({
      kind: "profile-session",
      profile: {
        profileId: PROFILE_ID,
        pubDress: "0x0sky",
        experience: { authority: "client", bondXp: 21, avaiaXp: 3 },
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/v1/product/session", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("authorization");
  });

  it("returns anonymous only on 401 and fails closed on malformed data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        answer(401, { error: { code: "product_session_required" } }),
      )
      .mockResolvedValueOnce(
        answer(200, { profile: { profile_id: PROFILE_ID } }),
      )
      .mockResolvedValueOnce(
        answer(200, {
          profile: {
            profile_id: PROFILE_ID,
            experience: { authority: "identity", bond_xp: 900, avaia_xp: 50 },
          },
        }),
      )
      .mockResolvedValueOnce(
        answer(503, { error: { code: "not_configured" } }),
      );
    const client = createAisProductSessionPort({ fetch });
    expect(await client.readSession()).toEqual({ kind: "anonymous" });
    expect(await client.readSession()).toEqual({ kind: "unavailable" });
    expect(await client.readSession()).toEqual({ kind: "unavailable" });
    expect(await client.readSession()).toEqual({ kind: "unavailable" });
  });

  it("signs out the AIS product session with CSRF, not native credentials", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(answer(200, { signed_out: true }))
      .mockResolvedValueOnce(answer(503, { error: { code: "unavailable" } }));
    const client = createAisProductSessionPort({ fetch });
    expect(await client.signOut()).toEqual({ kind: "signed-out" });
    expect(fetch).toHaveBeenCalledWith("/api/v1/product/session/sign-out", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-0x1-csrf": "1" },
    });
    expect(await client.signOut()).toEqual({ kind: "unavailable" });
    expect(JSON.stringify(fetch.mock.calls)).not.toContain("authorization");
  });
});
