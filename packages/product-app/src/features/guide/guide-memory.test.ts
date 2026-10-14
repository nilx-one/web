// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  forgetGuideSession,
  guideIntroOwed,
  guideIntroWaitMs,
  guideSnoozeWindow,
  guideTerritoryOwed,
  postponeGuideIntro,
  readGuideIntro,
  rememberFirstCellOpened,
  rememberGuideIntro,
  rememberGuideTerritory,
  type GuideMemoryStorage,
} from "./guide-memory";

function memoryStorage(): GuideMemoryStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

afterEach(() => forgetGuideSession());

describe("whether xSasha still has to introduce herself", () => {
  it("is owed to a Bond she has never met", () => {
    expect(guideIntroOwed("0x0sky", memoryStorage())).toBe(true);
  });

  it("is kept per Bond once played through or skipped", () => {
    const storage = memoryStorage();
    rememberGuideIntro("0x0sky", "skipped", storage);
    expect(readGuideIntro("0x0sky", storage)).toBe("skipped");
    expect(guideIntroOwed("0x0sky", storage)).toBe(false);
    expect(guideIntroOwed("0xda-sha", storage)).toBe(true);
    expect(storage.items.get("nilx-one.guide.v1.0x0sky")).toBe(
      JSON.stringify({ intro: "skipped" }),
    );
  });

  it("is still owed when she was only put off", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    expect(guideIntroOwed("0x0sky", storage)).toBe(true);
    expect(storage.items.get("nilx-one.guide.v1.0x0sky")).toBe(
      JSON.stringify({ introSnooze: { skips: 1, at: 0 } }),
    );
  });

  it("ignores what it cannot read", () => {
    const storage = memoryStorage();
    storage.items.set("nilx-one.guide.v1.0x0sky", "{not json");
    expect(readGuideIntro("0x0sky", storage)).toBeUndefined();
    storage.items.set("nilx-one.guide.v1.0x0sky", '{"intro":"maybe"}');
    expect(readGuideIntro("0x0sky", storage)).toBeUndefined();
  });
});

const MINUTE = 60_000;
const wait = (
  storage: GuideMemoryStorage,
  openedAtMin: number,
  nowMin: number,
  owner = "0x0sky",
) =>
  guideIntroWaitMs(owner, openedAtMin * MINUTE, nowMin * MINUTE, storage) /
  MINUTE;

describe("when she comes back after being put off", () => {
  it("has no wait for a Bond nobody put her off for", () => {
    expect(wait(memoryStorage(), 0, 0)).toBe(0);
  });

  it("keeps away from a login within half an hour, and takes one after it", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    expect(wait(storage, 15, 15)).toBe(45);
    expect(wait(storage, 29, 29)).toBe(31);
    expect(wait(storage, 30, 30)).toBe(0);
    expect(wait(storage, 45, 45)).toBe(0);
  });

  it("comes on her own an hour on, with no login to bring her", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    // Opened at 15 minutes, which was too soon: she waits for the hour.
    expect(wait(storage, 15, 15)).toBe(45);
    expect(wait(storage, 15, 59)).toBe(1);
    expect(wait(storage, 15, 60)).toBe(0);
    expect(wait(storage, 15, 200)).toBe(0);
  });

  it("does not count the session she was put off in as having come back to it", () => {
    const storage = memoryStorage();
    // The world was opened at minute 10, and she was put off in it at 40.
    postponeGuideIntro("0x0sky", 40 * MINUTE, storage);
    expect(wait(storage, 10, 41)).toBe(59);
    expect(wait(storage, 10, 100)).toBe(0);
  });

  it("doubles both waits each time she is put off again", () => {
    expect(
      [1, 2, 3, 4].map((skips) => {
        const { minMs, maxMs } = guideSnoozeWindow(skips);
        return [minMs / MINUTE, maxMs / MINUTE];
      }),
    ).toEqual([
      [30, 60],
      [60, 120],
      [120, 240],
      [240, 480],
    ]);

    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    postponeGuideIntro("0x0sky", 65 * MINUTE, storage);
    // Put off a second time at minute 65: an hour at the least, two at the
    // most. A login at minute 100 is only 35 minutes on, so she waits for
    // the two hours.
    expect(wait(storage, 100, 100)).toBe(85);
    expect(wait(storage, 125, 125)).toBe(0);
    expect(wait(storage, 100, 185)).toBe(0);
    expect(wait(storage, 100, 184)).toBe(1);
  });

  it("counts each Bond on its own", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    postponeGuideIntro("0x0sky", 0, storage);
    expect(wait(storage, 40, 40, "another")).toBe(0);
    expect(wait(storage, 40, 40)).toBe(80);
  });

  it("is remembered between sessions and ends with the introduction", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 0, storage);
    forgetGuideSession();
    expect(wait(storage, 40, 40)).toBe(0);
    expect(wait(storage, 10, 10)).toBe(50);
    rememberGuideIntro("0x0sky", "done", storage);
    expect(guideIntroOwed("0x0sky", storage)).toBe(false);
  });

  it("is kept for the session when the device has nowhere to keep it", () => {
    const failing: GuideMemoryStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("full");
      },
    };
    postponeGuideIntro("0x0sky", 0, failing);
    postponeGuideIntro("0x0sky", 0, failing);
    expect(wait(failing, 0, 10)).toBe(110);
  });

  it("starts the wait over from now when the clock was set back", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky", 500 * MINUTE, storage);
    expect(wait(storage, 10, 20)).toBe(60);
    // She is no longer waited for as of a time that has not come.
    expect(wait(storage, 10, 80)).toBe(0);
  });

  it("does not take a login stamped after now for a session that came after her", () => {
    const storage = memoryStorage();
    // Put off at minute 500, the world opened at 100, and the clock now says
    // 20: it was set back, and the wait starts over from now.
    postponeGuideIntro("0x0sky", 500 * MINUTE, storage);
    expect(wait(storage, 100, 20)).toBe(60);
    expect(wait(storage, 100, 79)).toBe(1);
    expect(wait(storage, 100, 80)).toBe(0);
  });

  it("ignores a snooze it cannot read", () => {
    const storage = memoryStorage();
    storage.items.set(
      "nilx-one.guide.v1.0x0sky",
      JSON.stringify({ introSnooze: { skips: 0, at: "yesterday" } }),
    );
    expect(wait(storage, 5, 5)).toBe(0);
  });
});

describe("her word on new ground", () => {
  it("is owed once the first cell is opened, and only until it is said", () => {
    const storage = memoryStorage();
    expect(guideTerritoryOwed("0x0sky", storage)).toBe(false);
    rememberFirstCellOpened("0x0sky", storage);
    expect(guideTerritoryOwed("0x0sky", storage)).toBe(true);
    rememberGuideTerritory("0x0sky", storage);
    expect(guideTerritoryOwed("0x0sky", storage)).toBe(false);
    rememberFirstCellOpened("0x0sky", storage);
    expect(guideTerritoryOwed("0x0sky", storage)).toBe(false);
    expect(guideTerritoryOwed("another", storage)).toBe(false);
  });
});
