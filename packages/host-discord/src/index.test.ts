// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { bootstrapDiscordActivity } from "./index";

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
});
