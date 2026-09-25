// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  hasAvaiaProfileAccess,
  PublishAvaiaLocation,
  ReadAvaiaProfile,
  UpdateAvaiaProfile,
  type AvaiaProfileAccessPort,
} from "./avaia-profile";

const profile = {
  pubDress: "x0skai",
  ownerPubDress: "0x0sky",
  configurationState: "configured",
} as const;

function accessPort(
  overrides: Partial<AvaiaProfileAccessPort> = {},
): AvaiaProfileAccessPort {
  return {
    readAvaiaProfile: async () => ({ kind: "available", profile }),
    updateAvaiaProfile: async () => ({ kind: "updated", profile }),
    publishAvaiaLocation: async () => ({ kind: "published", profile }),
    ...overrides,
  };
}

describe("Avaia profile capability", () => {
  it("recognises an identity client that answers for the Avaia profile", () => {
    expect(hasAvaiaProfileAccess(accessPort())).toBe(true);
    expect(hasAvaiaProfileAccess({ readAvaiaProfile: () => undefined })).toBe(
      false,
    );
    expect(
      hasAvaiaProfileAccess({
        readAvaiaProfile: async () => ({ kind: "available", profile }),
        updateAvaiaProfile: async () => ({ kind: "updated", profile }),
      }),
    ).toBe(false);
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
      new UpdateAvaiaProfile(failing).execute("x0skai"),
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

    await new UpdateAvaiaProfile(port).execute("x0vesnai");
    expect(seen).toEqual(["x0vesnai"]);
  });

  it("publishes the position exactly as given", async () => {
    const seen: unknown[] = [];
    const position = { longitude: 30.5234, latitude: 50.4501 };
    const port = accessPort({
      publishAvaiaLocation: async (published) => {
        seen.push(published);
        return { kind: "published", profile };
      },
    });

    await expect(
      new PublishAvaiaLocation(port).execute(position),
    ).resolves.toEqual({ kind: "published", profile });
    expect(seen).toEqual([position]);
  });

  it("keeps a publish transport failure a service fact rather than a rejection", async () => {
    const failing = accessPort({
      publishAvaiaLocation: async () => {
        throw new Error("offline");
      },
    });

    await expect(
      new PublishAvaiaLocation(failing).execute({
        longitude: 30.5234,
        latitude: 50.4501,
      }),
    ).resolves.toEqual({ kind: "service-unavailable" });
  });
});
