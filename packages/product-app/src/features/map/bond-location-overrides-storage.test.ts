// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { setBondLocationOverride } from "@nilx-one/application";
import { describe, expect, it } from "vitest";

import {
  readBondLocationOverrides,
  writeBondLocationOverrides,
} from "./bond-location-overrides-storage";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("Bond location override storage", () => {
  it("round-trips overrides without storing observed location", () => {
    const storage = memoryStorage();
    const overrides = setBondLocationOverride(new Map(), "0x1friend", {
      longitude: 2.3522,
      latitude: 48.8566,
    });

    expect(writeBondLocationOverrides(storage, "0x0owner", overrides)).toBe(
      "saved",
    );
    expect(readBondLocationOverrides(storage, "0x0owner")).toEqual({
      kind: "ready",
      overrides,
    });
  });

  it("scopes policies to the authenticated owner", () => {
    const storage = memoryStorage();
    const first = setBondLocationOverride(new Map(), "0x1friend", {
      longitude: 2.3522,
      latitude: 48.8566,
    });

    writeBondLocationOverrides(storage, "0x0owner", first);

    expect(readBondLocationOverrides(storage, "0x2other")).toEqual({
      kind: "ready",
      overrides: new Map(),
    });
  });

  it("reports corrupt policy instead of treating it as no override", () => {
    const values = new Map<string, string>([
      ["nilx-one.bond-location-overrides.v1:0x0owner", "{broken"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
    };

    expect(readBondLocationOverrides(storage, "0x0owner")).toEqual({
      kind: "corrupt",
    });
  });

  it("rejects an invalid stored position as corrupt policy", () => {
    const document = JSON.stringify({
      version: 1,
      entries: [
        {
          counterpartPubDress: "0x1friend",
          longitude: 181,
          latitude: 48.8566,
        },
      ],
    });
    const storage = {
      getItem: () => document,
    };

    expect(readBondLocationOverrides(storage, "0x0owner")).toEqual({
      kind: "corrupt",
    });
  });

  it("keeps an in-memory empty policy when storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("disabled");
      },
    };

    expect(readBondLocationOverrides(storage, "0x0owner")).toEqual({
      kind: "unavailable",
      overrides: new Map(),
    });
  });
});
