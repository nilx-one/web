// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from "vitest";

import {
  EMPTY_PROGRESSION,
  LEVEL_ONE_EXPERIENCE,
  XP_AVAIA_CONFIGURED,
  XP_LANDMARK_NOTICED_MANUALLY,
  XP_LANDMARK_STUDIED_BY_AVAIA,
  XP_ZONE_REVEALED_BY_AVAIA,
  XP_ZONE_REVEALED_MANUALLY,
  awardExperience,
  forgetProgressionCache,
  levelForExperience,
  markAvaiaConfigured,
  progressionSnapshot,
  readProgression,
  subscribeProgression,
  updateProgression,
  writeProgression,
  type ProgressionStorage,
} from "./progression";

function memoryStorage(): ProgressionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

beforeEach(() => {
  forgetProgressionCache();
});

describe("the experience economy", () => {
  it("prices manual zone reveals above the Avaia's own", () => {
    expect(XP_ZONE_REVEALED_MANUALLY).toBeGreaterThan(
      XP_ZONE_REVEALED_BY_AVAIA,
    );
  });

  it("prices the Avaia's own monument study above a manual notice", () => {
    expect(XP_LANDMARK_STUDIED_BY_AVAIA).toBeGreaterThan(
      XP_LANDMARK_NOTICED_MANUALLY,
    );
  });

  it("pays exactly what level 1 costs for configuring an owned Avaia", () => {
    expect(XP_AVAIA_CONFIGURED).toBe(LEVEL_ONE_EXPERIENCE);
  });
});

describe("levelForExperience", () => {
  it("starts at 0 and reaches 1 once 40 is earned", () => {
    expect(levelForExperience(0)).toBe(0);
    expect(levelForExperience(39)).toBe(0);
    expect(levelForExperience(40)).toBe(1);
    expect(levelForExperience(1_000)).toBe(1);
  });
});

describe("awardExperience", () => {
  it("adds experience and recomputes the level", () => {
    const first = awardExperience(EMPTY_PROGRESSION, XP_ZONE_REVEALED_BY_AVAIA);
    expect(first).toEqual({
      totalXp: XP_ZONE_REVEALED_BY_AVAIA,
      level: 0,
      avaiaConfigured: false,
    });

    const leveled = awardExperience(first, XP_AVAIA_CONFIGURED);
    expect(leveled.level).toBe(1);
    expect(leveled.totalXp).toBe(
      XP_ZONE_REVEALED_BY_AVAIA + XP_AVAIA_CONFIGURED,
    );
  });

  it("ignores a non-positive amount", () => {
    expect(awardExperience(EMPTY_PROGRESSION, 0)).toBe(EMPTY_PROGRESSION);
    expect(awardExperience(EMPTY_PROGRESSION, -5)).toBe(EMPTY_PROGRESSION);
  });
});

describe("markAvaiaConfigured", () => {
  it("pays the configuration reward once", () => {
    const configured = markAvaiaConfigured(EMPTY_PROGRESSION);
    expect(configured).toEqual({
      totalXp: XP_AVAIA_CONFIGURED,
      level: 1,
      avaiaConfigured: true,
    });

    // A repeat save never pays twice.
    expect(markAvaiaConfigured(configured)).toBe(configured);
  });
});

describe("storage", () => {
  it("reads nothing for a Bond it has never written", () => {
    const storage = memoryStorage();
    expect(readProgression("0x0sky", storage)).toBe(EMPTY_PROGRESSION);
  });

  it("round-trips what it wrote, one Bond at a time", () => {
    const storage = memoryStorage();
    const earned = awardExperience(
      EMPTY_PROGRESSION,
      XP_LANDMARK_STUDIED_BY_AVAIA,
    );
    writeProgression("0x0sky", earned, storage);

    expect(readProgression("0x0sky", storage)).toEqual(earned);
    expect(readProgression("0x0mira", storage)).toBe(EMPTY_PROGRESSION);
  });

  it("never throws on a corrupted record", () => {
    const storage = memoryStorage();
    storage.data.set("nilx-one.progression.v1.0x0sky", "{not json");
    expect(readProgression("0x0sky", storage)).toBe(EMPTY_PROGRESSION);

    storage.data.set(
      "nilx-one.progression.v1.0x0sky",
      JSON.stringify({ totalXp: "forty" }),
    );
    expect(readProgression("0x0sky", storage)).toBe(EMPTY_PROGRESSION);
  });
});

describe("the shared store", () => {
  it("notifies subscribers only when something actually changed", () => {
    let notifications = 0;
    const unsubscribe = subscribeProgression(() => {
      notifications += 1;
    });

    const first = updateProgression("0x0sky", (current) =>
      awardExperience(current, XP_ZONE_REVEALED_MANUALLY),
    );
    expect(first.totalXp).toBe(XP_ZONE_REVEALED_MANUALLY);
    expect(notifications).toBe(1);

    // A no-op change never fires a listener.
    updateProgression("0x0sky", (current) => current);
    expect(notifications).toBe(1);

    expect(progressionSnapshot("0x0sky")).toBe(first);
    unsubscribe();
  });
});
