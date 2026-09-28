// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { WIPE_EPOCH, wipeLocalWorldOnce } from "./world-wipe";

function memoryStorage(seed: Record<string, string>): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe("wipeLocalWorldOnce", () => {
  it("forgets the game, keeps the screen, and runs once", () => {
    const storage = memoryStorage({
      "nilx-one.fog.reveals.v1.x": "1",
      "nilx-one.progression.v3.x": "1",
      "nilx-one.interface.locale": "uk",
    });
    expect(wipeLocalWorldOnce(storage)).toBe(true);
    expect(storage.getItem("nilx-one.fog.reveals.v1.x")).toBeNull();
    expect(storage.getItem("nilx-one.progression.v3.x")).toBeNull();
    expect(storage.getItem("nilx-one.interface.locale")).toBe("uk");
    expect(storage.getItem("nilx-one.wipe-epoch")).toBe(WIPE_EPOCH);
    expect(wipeLocalWorldOnce(storage)).toBe(false);
  });
});
