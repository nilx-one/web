// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  hasAvaiaProfileAccess,
  ReadAvaiaProfile,
  UpdateAvaiaProfile,
  type AvaiaProfileAccessPort,
} from "./avaia-profile";

const profile = {
  pubDress: "0skai",
  ownerPubDress: "0x0sky",
  configurationState: "configured",
} as const;

function accessPort(
  overrides: Partial<AvaiaProfileAccessPort> = {},
): AvaiaProfileAccessPort {
  return {
    readAvaiaProfile: async () => ({ kind: "available", profile }),
    updateAvaiaProfile: async () => ({ kind: "updated", profile }),
    ...overrides,
  };
}

describe("Avaia profile capability", () => {
  it("recognises an identity client that answers for the Avaia profile", () => {
    expect(hasAvaiaProfileAccess(accessPort())).toBe(true);
    expect(hasAvaiaProfileAccess({ readAvaiaProfile: () => undefined })).toBe(
      false,
    );
    expect(hasAvaiaProfileAccess(undefined)).toBe(false);
  });

  it("reads the stored profile the service answered with", async () => {
    await expect(new ReadAvaiaProfile(accessPort()).execute()).resolves.toEqual(
      { kind: "available", profile },
    );
  });

  it("keeps a transport failure a service fact rather than a rejection", async () => {
    const failing = accessPort({
      readAvaiaProfile: async () => {
        throw new Error("offline");
      },
      updateAvaiaProfile: async () => {
        throw new Error("offline");
      },
    });

    await expect(new ReadAvaiaProfile(failing).execute()).resolves.toEqual({
      kind: "service-unavailable",
    });
    await expect(
      new UpdateAvaiaProfile(failing).execute("0skai"),
    ).resolves.toEqual({ kind: "service-unavailable" });
  });

  it("passes the whole address to the service rather than a derived name", async () => {
    const seen: string[] = [];
    const port = accessPort({
      updateAvaiaProfile: async (pubDress) => {
        seen.push(pubDress);
        return { kind: "updated", profile };
      },
    });

    await new UpdateAvaiaProfile(port).execute("0vesnai");
    expect(seen).toEqual(["0vesnai"]);
  });
});
