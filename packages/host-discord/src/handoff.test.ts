// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { createDiscordHandoffHost, readDiscordHandoff } from "./handoff";
import { DISCORD_CREDENTIAL_HANDOFF_URL, createDiscordHost } from "./index";

function mediaQueryList(): MediaQueryList {
  return {
    matches: true,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

describe("Discord credential hand-off", () => {
  it("sends the Activity's password setup to the product origin", () => {
    const openExternalLink = vi.fn().mockResolvedValue({ opened: true });
    const host = createDiscordHost(
      {
        ready: vi.fn(),
        commands: {
          authorize: vi.fn(),
          authenticate: vi.fn(),
          encourageHardwareAcceleration: vi.fn(),
          openExternalLink,
        },
      } as unknown as Parameters<typeof createDiscordHost>[0],
      { matchMedia: () => mediaQueryList() },
    );

    expect(host.credentialHandoff?.href).toBe(DISCORD_CREDENTIAL_HANDOFF_URL);
    expect(host.credentialHandoff?.origin).toBe("https://nilx.one");

    host.openExternal(host.credentialHandoff!);
    expect(openExternalLink).toHaveBeenCalledWith({
      url: DISCORD_CREDENTIAL_HANDOFF_URL,
    });
  });

  it("presents the product-origin page as the Discord host, not the Web one", () => {
    const open = vi.fn(() => null);
    const host = createDiscordHandoffHost({
      matchMedia: () => mediaQueryList(),
      open,
    });

    expect(host.getSnapshot()).toMatchObject({
      kind: "discord",
      available: true,
      theme: "dark",
      authentication: { kind: "discord-oauth", authenticated: true },
    });
    // This origin owns the password, so nothing is handed further.
    expect(host.credentialHandoff).toBeUndefined();

    host.openExternal(new URL("https://discord.com/"));
    expect(open).toHaveBeenCalledWith(
      "https://discord.com/",
      "_blank",
      "noopener,noreferrer",
    );
    expect(() => host.openExternal(new URL("javascript:alert(1)"))).toThrow();
  });

  it("accepts a hand-off only when the service confirms it", async () => {
    const answer = (status: number, body: unknown) =>
      vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(JSON.stringify(body), { status }));

    const active = answer(200, { state: "active" });
    await expect(readDiscordHandoff(active)).resolves.toBe(true);
    expect(active).toHaveBeenCalledWith(
      "/api/v1/auth/discord/handoff",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    await expect(
      readDiscordHandoff(answer(200, { state: "none" })),
    ).resolves.toBe(false);
    await expect(readDiscordHandoff(answer(503, {}))).resolves.toBe(false);
    await expect(
      readDiscordHandoff(
        vi
          .fn<typeof globalThis.fetch>()
          .mockRejectedValue(new Error("offline")),
      ),
    ).resolves.toBe(false);
  });
});
