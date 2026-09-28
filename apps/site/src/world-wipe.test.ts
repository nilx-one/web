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

function factory(
  behaviour: "success" | "error" | "throw",
  deleted: string[] = [],
): IDBFactory {
  return {
    deleteDatabase(name: string) {
      if (behaviour === "throw") throw new Error("denied");
      const request = {} as IDBOpenDBRequest;
      queueMicrotask(() => {
        deleted.push(name);
        if (behaviour === "error") {
          Object.defineProperty(request, "error", {
            value: new Error("boom"),
          });
          request.onerror?.({} as Event);
        } else {
          request.onsuccess?.({} as Event);
        }
      });
      return request;
    },
  } as unknown as IDBFactory;
}

const seed = () => ({
  "nilx-one.fog.reveals.v1.x": "1",
  "nilx-one.progression.v3.x": "1",
  "nilx-one.interface.locale": "uk",
});

describe("wipeLocalWorldOnce", () => {
  it("forgets the game, keeps the screen, waits for the database, runs once", async () => {
    const storage = memoryStorage(seed());
    const deleted: string[] = [];

    expect(
      await wipeLocalWorldOnce(storage, factory("success", deleted)),
    ).toEqual({ status: "wiped" });
    expect(deleted).toEqual(["nilx-presence"]);
    expect(storage.getItem("nilx-one.fog.reveals.v1.x")).toBeNull();
    expect(storage.getItem("nilx-one.progression.v3.x")).toBeNull();
    expect(storage.getItem("nilx-one.interface.locale")).toBe("uk");
    expect(storage.getItem("nilx-one.wipe-epoch")).toBe(WIPE_EPOCH);
    expect(await wipeLocalWorldOnce(storage, factory("success"))).toEqual({
      status: "skipped",
    });
  });

  it.each(["error", "throw"] as const)(
    "reports a database that would not go (%s) and tries again next load",
    async (behaviour) => {
      const storage = memoryStorage(seed());

      const outcome = await wipeLocalWorldOnce(storage, factory(behaviour));

      expect(outcome.status).toBe("incomplete");
      expect(storage.getItem("nilx-one.wipe-epoch")).toBeNull();
      expect(storage.getItem("nilx-one.fog.reveals.v1.x")).toBeNull();
      expect(
        (await wipeLocalWorldOnce(storage, factory("success"))).status,
      ).toBe("wiped");
    },
  );
});
