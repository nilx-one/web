// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  createDiscordProxyFetch,
  installDiscordProxyRouting,
  resolveDiscordProxyUrl,
  type DiscordProxyLocation,
  type DiscordProxyScope,
} from "./proxy";

const ACTIVITY: DiscordProxyLocation = {
  hostname: "1234567890.discordsays.com",
  origin: "https://1234567890.discordsays.com",
};

const BROWSER: DiscordProxyLocation = {
  hostname: "nilx.one",
  origin: "https://nilx.one",
};

describe("Discord proxy URLs", () => {
  it("re-roots the client's absolute paths under the proxy prefix", () => {
    expect(
      resolveDiscordProxyUrl("/api/v1/auth/discord/config", ACTIVITY),
    ).toBe("/.proxy/api/v1/auth/discord/config");
    expect(resolveDiscordProxyUrl("/core/0.1.0", ACTIVITY)).toBe(
      "/.proxy/core/0.1.0",
    );
  });

  it("keeps the query and fragment of a re-rooted path", () => {
    expect(resolveDiscordProxyUrl("/map/0.1.0/style.json?v=2", ACTIVITY)).toBe(
      "/.proxy/map/0.1.0/style.json?v=2",
    );
  });

  it("re-roots an absolute same-origin URL", () => {
    expect(
      resolveDiscordProxyUrl(
        "https://1234567890.discordsays.com/map/0.1.0/basemap.pmtiles",
        ACTIVITY,
      ),
    ).toBe(
      "https://1234567890.discordsays.com/.proxy/map/0.1.0/basemap.pmtiles",
    );
  });

  it("never re-roots an already proxied path", () => {
    expect(resolveDiscordProxyUrl("/.proxy/api/v1/identity", ACTIVITY)).toBe(
      "/.proxy/api/v1/identity",
    );
  });

  it("leaves relative references and foreign origins alone", () => {
    expect(resolveDiscordProxyUrl("assets/index.js", ACTIVITY)).toBe(
      "assets/index.js",
    );
    expect(resolveDiscordProxyUrl("https://discord.com/api", ACTIVITY)).toBe(
      "https://discord.com/api",
    );
    expect(resolveDiscordProxyUrl("//cdn.example/x.js", ACTIVITY)).toBe(
      "//cdn.example/x.js",
    );
  });

  it("changes nothing outside a Discord Activity", () => {
    expect(resolveDiscordProxyUrl("/api/v1/identity", BROWSER)).toBe(
      "/api/v1/identity",
    );
  });
});

describe("Discord proxy transport", () => {
  it("routes string, URL, and Request inputs through the proxy", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const proxied = createDiscordProxyFetch(fetch, ACTIVITY);

    await proxied("/api/v1/identity");
    await proxied(new URL("https://1234567890.discordsays.com/map/0.1.0"));
    await proxied(new Request("https://1234567890.discordsays.com/core/0.1.0"));

    expect(fetch.mock.calls[0]?.[0]).toBe("/.proxy/api/v1/identity");
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://1234567890.discordsays.com/.proxy/map/0.1.0",
    );
    expect((fetch.mock.calls[2]?.[0] as Request).url).toBe(
      "https://1234567890.discordsays.com/.proxy/core/0.1.0",
    );
  });

  it("returns the original transport outside a Discord Activity", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    expect(createDiscordProxyFetch(fetch, BROWSER)).toBe(fetch);
  });
});

describe("Discord proxy routing", () => {
  function scope(location: DiscordProxyLocation): DiscordProxyScope {
    return {
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 204 })),
      location,
    };
  }

  it("proxies every request the shared scope makes, until it is undone", async () => {
    const target = scope(ACTIVITY);
    const original = target.fetch;
    const undo = installDiscordProxyRouting(target);

    await target.fetch("/map/0.1.0/style.json");
    expect(original).toHaveBeenCalledWith(
      "/.proxy/map/0.1.0/style.json",
      undefined,
    );

    undo();
    expect(target.fetch).toBe(original);
  });

  it("leaves the shared scope untouched outside a Discord Activity", async () => {
    const target = scope(BROWSER);
    const original = target.fetch;

    installDiscordProxyRouting(target)();

    await target.fetch("/map/0.1.0/style.json");
    expect(target.fetch).toBe(original);
    expect(original).toHaveBeenCalledWith("/map/0.1.0/style.json");
  });
});
