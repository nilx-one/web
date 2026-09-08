// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { UNSUPPORTED_GEOLOCATION } from "@nilx-one/host-contract";
import { describe, expect, it, vi } from "vitest";

import { bootstrapDiscordActivity, createDiscordHost } from "./index";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mediaQueryList(): MediaQueryList {
  return {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe("Discord Activity host", () => {
  it("completes Discord OAuth before exposing an authenticated host", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { client_id: "client-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "access-1" }));
    const ready = vi.fn().mockResolvedValue(undefined);
    const authorize = vi.fn().mockResolvedValue({ code: "code-1" });
    const authenticate = vi.fn().mockResolvedValue({ user: { id: "42" } });
    const encourageHardwareAcceleration = vi
      .fn()
      .mockResolvedValue({ enabled: true });
    const openExternalLink = vi.fn().mockResolvedValue({ opened: true });

    const session = await bootstrapDiscordActivity({
      fetch,
      environment: { matchMedia: () => mediaQueryList() },
      sdkFactory: (clientId) => {
        expect(clientId).toBe("client-1");
        return {
          ready,
          commands: {
            authorize,
            authenticate,
            encourageHardwareAcceleration,
            openExternalLink,
          },
        };
      },
    });

    expect(ready).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "client-1",
        response_type: "code",
        scope: ["identify"],
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/discord/token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ code: "code-1" }),
      }),
    );
    expect(authenticate).toHaveBeenCalledWith({ access_token: "access-1" });
    expect(encourageHardwareAcceleration).toHaveBeenCalledOnce();
    expect(session.authorization).toBe("discord access-1");
    expect(session.host.getSnapshot()).toMatchObject({
      kind: "discord",
      available: true,
      authentication: {
        kind: "discord-oauth",
        authenticated: true,
      },
    });
  });

  it("reaches the identity service through the Discord proxy by default", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { client_id: "client-1" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "access-1" }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("location", {
      hostname: "1234567890.discordsays.com",
      origin: "https://1234567890.discordsays.com",
    });

    const session = await bootstrapDiscordActivity({
      environment: { matchMedia: () => mediaQueryList() },
      sdkFactory: () => ({
        ready: vi.fn().mockResolvedValue(undefined),
        commands: {
          authorize: vi.fn().mockResolvedValue({ code: "code-1" }),
          authenticate: vi.fn().mockResolvedValue({ user: { id: "42" } }),
          encourageHardwareAcceleration: vi
            .fn()
            .mockResolvedValue({ enabled: true }),
          openExternalLink: vi.fn().mockResolvedValue({ opened: true }),
        },
      }),
    });

    expect(fetch.mock.calls[0]?.[0]).toBe("/.proxy/api/v1/auth/discord/config");
    expect(fetch.mock.calls[1]?.[0]).toBe("/.proxy/api/v1/auth/discord/token");

    // Every adapter the composition root builds reuses the proxied transport.
    await session.fetch("/api/v1/identity");
    expect(fetch.mock.calls[2]?.[0]).toBe("/.proxy/api/v1/identity");

    vi.unstubAllGlobals();
  });
});

describe("Discord host geolocation", () => {
  const bridge = {
    ready: vi.fn(),
    commands: {
      authorize: vi.fn(),
      authenticate: vi.fn(),
      encourageHardwareAcceleration: vi.fn(),
      openExternalLink: vi.fn(),
    },
  } as unknown as Parameters<typeof createDiscordHost>[0];

  it("exposes the composed embedded-browser capability unchanged", () => {
    const geolocation = {
      readPermission: vi.fn(async () => "prompt" as const),
      requestPosition: vi.fn(async () => ({
        kind: "failed" as const,
        reason: "permission-denied" as const,
      })),
      watchPosition: vi.fn(() => () => undefined),
    };

    const host = createDiscordHost(bridge, {
      matchMedia: () => mediaQueryList(),
      geolocation,
    });

    expect(host.geolocation).toBe(geolocation);
  });

  it("answers unsupported when the composition provides no capability", () => {
    const host = createDiscordHost(bridge, {
      matchMedia: () => mediaQueryList(),
    });

    expect(host.geolocation).toBe(UNSUPPORTED_GEOLOCATION);
  });
});
