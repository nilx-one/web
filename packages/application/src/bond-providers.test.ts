// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  bondProviderConnection,
  bondProviderOpenTarget,
  bondProviderOpenTargets,
  connectBondProvider,
  connectedBondProviders,
  disconnectBondProvider,
  isBondProviderConnected,
  isBondProviderType,
  type BondProviderConnections,
} from "./bond-providers";

const TELEGRAM = { provider: "telegram", handle: "zerosky" } as const;
const DISCORD = {
  provider: "discord",
  externalId: "84759302847591038",
} as const;

describe("Bond provider attachment", () => {
  it("attaches a provider account to a Bond that has none", () => {
    const result = connectBondProvider([], TELEGRAM);

    expect(result).toEqual({ kind: "attached", connections: [TELEGRAM] });
  });

  it("refuses a second account of a provider the Bond already carries", () => {
    const connections: BondProviderConnections = [TELEGRAM];

    const result = connectBondProvider(connections, {
      provider: "telegram",
      handle: "othersky",
    });

    expect(result).toEqual({
      kind: "rejected",
      reason: "provider-already-attached",
    });
    // The refusal changes nothing: the first attachment stands.
    expect(connections).toEqual([TELEGRAM]);
  });

  it("carries one account of each supported provider at once", () => {
    const first = connectBondProvider([], TELEGRAM);
    expect(first.kind).toBe("attached");
    if (first.kind !== "attached") return;

    const second = connectBondProvider(first.connections, DISCORD);

    expect(second).toEqual({
      kind: "attached",
      connections: [TELEGRAM, DISCORD],
    });
  });

  it("collapses duplicates handed in from outside to one per provider", () => {
    const connections = connectedBondProviders([
      DISCORD,
      TELEGRAM,
      { provider: "discord", externalId: "11111111111111111" },
    ]);

    expect(connections).toEqual([TELEGRAM, DISCORD]);
  });

  it("detaches a connected provider without touching the others", () => {
    const result = disconnectBondProvider([TELEGRAM, DISCORD], "telegram");

    expect(result).toEqual({ kind: "detached", connections: [DISCORD] });
  });

  it("refuses to detach a provider the Bond never attached", () => {
    expect(disconnectBondProvider([TELEGRAM], "discord")).toEqual({
      kind: "rejected",
      reason: "not-attached",
    });
  });

  it("answers which providers a Bond carries", () => {
    expect(isBondProviderConnected([TELEGRAM], "telegram")).toBe(true);
    expect(isBondProviderConnected([TELEGRAM], "discord")).toBe(false);
    expect(bondProviderConnection([TELEGRAM], "telegram")).toEqual(TELEGRAM);
    expect(bondProviderConnection([TELEGRAM], "discord")).toBeUndefined();
    expect(isBondProviderType("telegram")).toBe(true);
    expect(isBondProviderType("matrix")).toBe(false);
  });
});

describe("Bond provider open targets", () => {
  it("prefers a provider scheme only where a host can follow one", () => {
    expect(
      bondProviderOpenTargets(TELEGRAM, { deepLinkCapable: true }),
    ).toEqual([
      { kind: "deep-link", url: "tg://resolve?domain=zerosky" },
      { kind: "canonical-web", url: "https://t.me/zerosky" },
      { kind: "provider-page", url: "https://t.me" },
    ]);

    expect(bondProviderOpenTarget(TELEGRAM)).toEqual({
      kind: "canonical-web",
      url: "https://t.me/zerosky",
    });
  });

  it("addresses a Discord account by its own account id", () => {
    expect(bondProviderOpenTargets(DISCORD, { deepLinkCapable: true })).toEqual(
      [
        { kind: "deep-link", url: "discord://-/users/84759302847591038" },
        {
          kind: "canonical-web",
          url: "https://discord.com/users/84759302847591038",
        },
        { kind: "provider-page", url: "https://discord.com/channels/@me" },
      ],
    );
  });

  it("falls back to the provider itself when the address is unusable", () => {
    // An attachment this client only knows as "a Telegram account" still opens.
    expect(bondProviderOpenTargets({ provider: "telegram" })).toEqual([
      { kind: "provider-page", url: "https://t.me" },
    ]);
    expect(
      bondProviderOpenTargets({ provider: "telegram", handle: "@no" }),
    ).toEqual([{ kind: "provider-page", url: "https://t.me" }]);
    expect(
      bondProviderOpenTargets({ provider: "discord", externalId: "not-an-id" }),
    ).toEqual([
      { kind: "provider-page", url: "https://discord.com/channels/@me" },
    ]);
  });

  it("reads a Telegram handle written the way a person writes it", () => {
    expect(
      bondProviderOpenTarget({ provider: "telegram", handle: " @zerosky " }),
    ).toEqual({ kind: "canonical-web", url: "https://t.me/zerosky" });
  });
});
