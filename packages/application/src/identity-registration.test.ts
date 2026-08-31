// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  ReadIdentity,
  RegisterIdentity,
  type IdentityRegistrationPort,
} from "./identity-registration";

describe("identity registration use cases", () => {
  it("preserves adapter results without creating identity client-side", async () => {
    const adapter: IdentityRegistrationPort = {
      read: async () => ({ kind: "not-registered" }),
      register: async ({ discriminator, slug }) => ({
        kind: "registered",
        outcome: "created",
        identity: { pubDress: `0x${discriminator}${slug}` },
      }),
    };

    await expect(new ReadIdentity(adapter).execute()).resolves.toEqual({
      kind: "not-registered",
    });
    await expect(
      new RegisterIdentity(adapter).execute({
        discriminator: "0",
        slug: "sky",
      }),
    ).resolves.toEqual({
      kind: "registered",
      outcome: "created",
      identity: { pubDress: "0x0sky" },
    });
  });

  it("maps transport exceptions to an observable unavailable state", async () => {
    const adapter: IdentityRegistrationPort = {
      read: () => Promise.reject(new Error("offline")),
      register: () => Promise.reject(new Error("offline")),
    };

    await expect(new ReadIdentity(adapter).execute()).resolves.toEqual({
      kind: "service-unavailable",
    });
    await expect(
      new RegisterIdentity(adapter).execute({
        discriminator: "0",
        slug: "sky",
      }),
    ).resolves.toEqual({ kind: "service-unavailable" });
  });
});
