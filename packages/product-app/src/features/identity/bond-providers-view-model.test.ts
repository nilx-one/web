// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { createBondProvidersViewState } from "./bond-providers-view-model";

describe("Bond providers view state", () => {
  it("presents every supported provider with its connection state", () => {
    const state = createBondProvidersViewState([
      { provider: "telegram", handle: "zerosky" },
    ]);

    expect(state.rows.map((row) => row.provider)).toEqual([
      "telegram",
      "discord",
    ]);
    expect(state.rows[0]?.status).toBe("Connected");
    expect(state.rows[1]?.status).toBe("Not connected");
    expect(state.connectable).toBe(true);
  });

  it("gives the compact row the attached providers and nothing else", () => {
    const state = createBondProvidersViewState([
      { provider: "discord", externalId: "84759302847591038" },
    ]);

    expect(state.connected.map((row) => row.glyph)).toEqual(["DC"]);
  });

  it("resolves an open target per host capability, web first in a browser", () => {
    const connections = [{ provider: "telegram", handle: "zerosky" }] as const;

    expect(createBondProvidersViewState(connections).rows[0]).toMatchObject({
      openKind: "canonical-web",
      openUrl: "https://t.me/zerosky",
    });
    expect(
      createBondProvidersViewState(connections, {
        deepLinkProviders: ["telegram"],
      }).rows[0],
    ).toMatchObject({
      openKind: "deep-link",
      openUrl: "tg://resolve?domain=zerosky",
    });
  });

  it("offers no open target for a provider the Bond has not attached", () => {
    const state = createBondProvidersViewState([]);

    expect(state.connected).toEqual([]);
    expect(state.rows[0]?.openUrl).toBeUndefined();
    expect(state.rows[0]?.connectHref).toBe(
      "/auth?provider=telegram&intent=connect",
    );
  });

  it("names disconnection as detachment from the Bond", () => {
    const state = createBondProvidersViewState([{ provider: "telegram" }]);

    expect(state.rows[0]?.disconnectLabel).toBe(
      "Disconnect Telegram from this Bond",
    );
  });

  it("never lets a repeated provider reach a screen twice", () => {
    const state = createBondProvidersViewState([
      { provider: "telegram", handle: "zerosky" },
      { provider: "telegram", handle: "othersky" },
    ]);

    expect(state.connected).toHaveLength(1);
    expect(state.connected[0]?.openUrl).toBe("https://t.me/zerosky");
  });
});
