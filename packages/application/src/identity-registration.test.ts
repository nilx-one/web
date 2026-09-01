// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AuthenticateNativeIdentity,
  ReadNativeIdentityContext,
  RegisterNativeIdentity,
  ResolvePubDress,
  formatPubDress,
  parsePubDress,
  type IdentityAccessPort,
} from "./identity-registration";

function createPort(
  overrides: Partial<IdentityAccessPort> = {},
): IdentityAccessPort {
  return {
    acknowledgeRecoveryKey: async () => ({ kind: "service-unavailable" }),
    authenticateNative: async () => ({ kind: "service-unavailable" }),
    forgetRememberedBond: async () => ({ kind: "completed" }),
    logoutNative: async () => ({ kind: "completed" }),
    readNativeContext: async () => ({ kind: "anonymous" }),
    readProviderIdentity: async () => ({ kind: "not-registered" }),
    recoverNative: async () => ({ kind: "service-unavailable" }),
    registerNative: async () => ({ kind: "service-unavailable" }),
    registerProvider: async () => ({ kind: "service-unavailable" }),
    resolvePubDress: async (selection) => ({
      kind: "available",
      pubDress: formatPubDress(selection),
    }),
    ...overrides,
  };
}

describe("identity access use cases", () => {
  it("preserves exact case-sensitive address semantics", () => {
    expect(formatPubDress({ discriminator: "a", slug: "Sky" })).toBe("0xaSky");
    expect(parsePubDress("0xaSky")).toEqual({
      discriminator: "a",
      slug: "Sky",
    });
    expect(parsePubDress("0xgSky")).toBeUndefined();
  });

  it("keeps server facts and secrets outside client-side inference", async () => {
    const port = createPort({
      readNativeContext: async () => ({
        kind: "remembered",
        pubDress: "0x0sky",
      }),
      registerNative: async (pubDress) => ({
        kind: "recovery-key-required",
        identity: { pubDress },
        recoveryKey: "0x1-rk-secret",
        challenge: "0x1c-secret",
      }),
      authenticateNative: async (pubDress) => ({
        kind: "authenticated",
        identity: { pubDress },
      }),
    });

    await expect(
      new ReadNativeIdentityContext(port).execute(),
    ).resolves.toEqual({ kind: "remembered", pubDress: "0x0sky" });
    await expect(
      new ResolvePubDress(port).execute({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({ kind: "available", pubDress: "0x0sky" });
    await expect(
      new RegisterNativeIdentity(port).execute(
        "0x0sky",
        "deliberately long password",
        "idempotency-key-1",
      ),
    ).resolves.toMatchObject({
      kind: "recovery-key-required",
      identity: { pubDress: "0x0sky" },
    });
    await expect(
      new AuthenticateNativeIdentity(port).execute(
        "0x0sky",
        "deliberately long password",
      ),
    ).resolves.toEqual({
      kind: "authenticated",
      identity: { pubDress: "0x0sky" },
    });
  });

  it("maps transport exceptions to observable unavailable states", async () => {
    const port = createPort({
      readNativeContext: () => Promise.reject(new Error("offline")),
      registerNative: () => Promise.reject(new Error("offline")),
      authenticateNative: () => Promise.reject(new Error("offline")),
      resolvePubDress: () => Promise.reject(new Error("offline")),
    });

    await expect(
      new ReadNativeIdentityContext(port).execute(),
    ).resolves.toEqual({ kind: "service-unavailable" });
    await expect(
      new ResolvePubDress(port).execute({ discriminator: "0", slug: "sky" }),
    ).resolves.toEqual({ kind: "service-unavailable" });
    await expect(
      new RegisterNativeIdentity(port).execute(
        "0x0sky",
        "deliberately long password",
        "idempotency-key-1",
      ),
    ).resolves.toEqual({ kind: "service-unavailable" });
  });
});
