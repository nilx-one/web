// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  forgetGuideSession,
  guideIntroOwed,
  postponeGuideIntro,
  readGuideIntro,
  rememberGuideIntro,
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

  it("is put off for this session only when asked for later", () => {
    const storage = memoryStorage();
    postponeGuideIntro("0x0sky");
    expect(guideIntroOwed("0x0sky", storage)).toBe(false);
    expect(storage.items.size).toBe(0);
    forgetGuideSession();
    expect(guideIntroOwed("0x0sky", storage)).toBe(true);
  });

  it("ignores what it cannot read", () => {
    const storage = memoryStorage();
    storage.items.set("nilx-one.guide.v1.0x0sky", "{not json");
    expect(readGuideIntro("0x0sky", storage)).toBeUndefined();
    storage.items.set("nilx-one.guide.v1.0x0sky", '{"intro":"maybe"}');
    expect(readGuideIntro("0x0sky", storage)).toBeUndefined();
  });
});
