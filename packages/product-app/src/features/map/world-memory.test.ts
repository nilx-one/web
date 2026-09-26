// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  readWorldMemory,
  rememberWorld,
  type WorldMemoryStorage,
} from "./world-memory";

function memoryStorage(): WorldMemoryStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe("world memory", () => {
  it("remembers the Bond and the Avaia separately, per owner", () => {
    const storage = memoryStorage();
    rememberWorld(
      "0:bond",
      { bond: { longitude: 30.5, latitude: 50.4 } },
      storage,
    );
    rememberWorld(
      "0:bond",
      { avaia: { longitude: 30.52, latitude: 50.45, bearingDeg: 90 } },
      storage,
    );

    expect(readWorldMemory("0:bond", storage)).toEqual({
      bond: { longitude: 30.5, latitude: 50.4 },
      avaia: { longitude: 30.52, latitude: 50.45, bearingDeg: 90 },
    });
    expect(readWorldMemory("1:other", storage)).toEqual({});
  });

  it("forgets the Avaia without forgetting the Bond", () => {
    const storage = memoryStorage();
    rememberWorld(
      "0:bond",
      {
        bond: { longitude: 30.5, latitude: 50.4 },
        avaia: { longitude: 30.52, latitude: 50.45, bearingDeg: 0 },
      },
      storage,
    );
    rememberWorld("0:bond", { avaia: undefined }, storage);

    expect(readWorldMemory("0:bond", storage)).toEqual({
      bond: { longitude: 30.5, latitude: 50.4 },
    });
  });

  it("reads nothing from a corrupt or out-of-range record", () => {
    const storage = memoryStorage();
    storage.setItem("nilx-one.world-memory.v1.0:bond", "{not json");
    expect(readWorldMemory("0:bond", storage)).toEqual({});

    storage.setItem(
      "nilx-one.world-memory.v1.0:bond",
      JSON.stringify({
        bond: { longitude: 500, latitude: 50 },
        avaia: { longitude: 30, latitude: 50 },
      }),
    );
    expect(readWorldMemory("0:bond", storage)).toEqual({
      avaia: { longitude: 30, latitude: 50, bearingDeg: 0 },
    });
  });

  it("never throws when storage does", () => {
    const broken: WorldMemoryStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readWorldMemory("0:bond", broken)).toEqual({});
    expect(() =>
      rememberWorld("0:bond", { bond: { longitude: 0, latitude: 0 } }, broken),
    ).not.toThrow();
  });
});
