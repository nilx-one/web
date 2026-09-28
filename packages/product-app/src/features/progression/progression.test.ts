// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it } from "vitest";

import {
  ACHIEVEMENTS,
  EMPTY_PROGRESSION,
  XP_LANDMARK_NOTICED_MANUALLY,
  XP_LANDMARK_STUDIED_BY_AVAIA,
  XP_ZONE_REVEALED_BY_AVAIA,
  XP_ZONE_REVEALED_MANUALLY,
  avaiaExperienceForLevel,
  avaiaLevelForExperience,
  awardExperience,
  bondExperienceForLevel,
  bondLevelForExperience,
  earnDeviceAchievement,
  forgetProgressionCache,
  markSettingsHintSeen,
  progressionSnapshot,
  progressionStanding,
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

const unconfigured = { avaiaConfigured: false };
const configured = { avaiaConfigured: true };

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

  it("pays each achievement what the design names", () => {
    expect(ACHIEVEMENTS["avaia-configured"]).toMatchObject({
      scope: "account",
      bondXp: 20,
      avaiaXp: 0,
    });
    expect(ACHIEVEMENTS["avaia-model-downloaded"]).toMatchObject({
      scope: "device",
      bondXp: 50,
      avaiaXp: 100,
    });
  });
});

describe("the Bond curve", () => {
  it("reaches level 1 in one or two actions", () => {
    expect(bondLevelForExperience(0)).toBe(0);
    expect(bondExperienceForLevel(1)).toBe(50);
    // Configuring the Avaia and walking one zone open.
    expect(
      bondLevelForExperience(
        ACHIEVEMENTS["avaia-configured"].bondXp + XP_ZONE_REVEALED_MANUALLY,
      ),
    ).toBe(1);
  });

  it("climbs steeply: level 4 takes a real amount of play", () => {
    expect(bondExperienceForLevel(2)).toBe(400);
    expect(bondExperienceForLevel(3)).toBe(1_350);
    expect(bondExperienceForLevel(4)).toBe(3_200);
    expect(bondLevelForExperience(3_199)).toBe(3);
    expect(bondLevelForExperience(3_200)).toBe(4);
    expect(
      bondExperienceForLevel(4) / XP_ZONE_REVEALED_MANUALLY,
    ).toBeGreaterThan(100);
  });
});

describe("the Avaia curve", () => {
  it("reaches level 1 by being configured, not by experience", () => {
    expect(avaiaLevelForExperience(0, false)).toBe(0);
    expect(avaiaLevelForExperience(10_000, false)).toBe(0);
    expect(avaiaLevelForExperience(0, true)).toBe(1);
  });

  it("climbs linearly, 150 per level, with no ceiling", () => {
    expect(avaiaExperienceForLevel(2)).toBe(150);
    expect(avaiaExperienceForLevel(3)).toBe(300);
    expect(avaiaLevelForExperience(149, true)).toBe(1);
    expect(avaiaLevelForExperience(150, true)).toBe(2);
    expect(avaiaLevelForExperience(300, true)).toBe(3);
    expect(avaiaExperienceForLevel(100)).toBe(14_850);
    expect(avaiaLevelForExperience(36_600, true)).toBe(245);
  });
});

describe("awardExperience", () => {
  it("pays whoever earned it, and only them", () => {
    const bond = awardExperience(
      EMPTY_PROGRESSION,
      "bond",
      XP_ZONE_REVEALED_MANUALLY,
    );
    expect(bond).toMatchObject({
      bondXp: XP_ZONE_REVEALED_MANUALLY,
      avaiaXp: 0,
    });

    const both = awardExperience(bond, "avaia", XP_ZONE_REVEALED_BY_AVAIA);
    expect(both).toMatchObject({
      bondXp: XP_ZONE_REVEALED_MANUALLY,
      avaiaXp: XP_ZONE_REVEALED_BY_AVAIA,
    });
  });

  it("ignores a non-positive amount", () => {
    expect(awardExperience(EMPTY_PROGRESSION, "bond", 0)).toBe(
      EMPTY_PROGRESSION,
    );
    expect(awardExperience(EMPTY_PROGRESSION, "avaia", -5)).toBe(
      EMPTY_PROGRESSION,
    );
  });
});

describe("achievements", () => {
  it("reads the configuration achievement from the service, never storage", () => {
    expect(progressionStanding(EMPTY_PROGRESSION, unconfigured)).toEqual({
      bond: { xp: 0, level: 0, nextLevelXp: 50 },
      avaia: { xp: 0, level: 0, nextLevelXp: 0 },
      achievements: [],
    });
    expect(progressionStanding(EMPTY_PROGRESSION, configured)).toEqual({
      bond: { xp: 20, level: 0, nextLevelXp: 50 },
      avaia: { xp: 0, level: 1, nextLevelXp: 150 },
      achievements: ["avaia-configured"],
    });
  });

  it("pays a device achievement once, to both the Bond and the Avaia", () => {
    const earned = earnDeviceAchievement(
      EMPTY_PROGRESSION,
      "avaia-model-downloaded",
    );
    expect(earnDeviceAchievement(earned, "avaia-model-downloaded")).toBe(
      earned,
    );
    expect(progressionStanding(earned, configured)).toEqual({
      bond: { xp: 70, level: 1, nextLevelXp: 400 },
      avaia: { xp: 100, level: 1, nextLevelXp: 150 },
      achievements: ["avaia-configured", "avaia-model-downloaded"],
    });
  });

  it("never stores an account achievement on the device", () => {
    expect(earnDeviceAchievement(EMPTY_PROGRESSION, "avaia-configured")).toBe(
      EMPTY_PROGRESSION,
    );
  });

  it("remembers the settings hint was seen, once", () => {
    const seen = markSettingsHintSeen(EMPTY_PROGRESSION);
    expect(seen.settingsHintSeen).toBe(true);
    expect(markSettingsHintSeen(seen)).toBe(seen);
  });
});

describe("storage", () => {
  it("reads nothing for a Bond it has never written", () => {
    const storage = memoryStorage();
    expect(readProgression("0x0sky", storage)).toBe(EMPTY_PROGRESSION);
  });

  it("round-trips what it wrote, one Bond at a time", () => {
    const storage = memoryStorage();
    const earned = earnDeviceAchievement(
      awardExperience(EMPTY_PROGRESSION, "avaia", XP_LANDMARK_STUDIED_BY_AVAIA),
      "avaia-model-downloaded",
    );
    writeProgression("0x0sky", earned, storage);

    expect(readProgression("0x0sky", storage)).toEqual(earned);
    expect(readProgression("0x0mira", storage)).toBe(EMPTY_PROGRESSION);
  });

  it("carries version 1 over as the Bond's own activity, less its old configuration reward", () => {
    const storage = memoryStorage();
    storage.data.set(
      "nilx-one.progression.v1.0x0sky",
      JSON.stringify({ totalXp: 130, level: 1, avaiaConfigured: true }),
    );
    storage.data.set(
      "nilx-one.progression.v1.0x0mira",
      JSON.stringify({ totalXp: 30, level: 0, avaiaConfigured: false }),
    );

    expect(readProgression("0x0sky", storage)).toEqual({
      ...EMPTY_PROGRESSION,
      bondXp: 90,
    });
    expect(readProgression("0x0mira", storage)).toEqual({
      ...EMPTY_PROGRESSION,
      bondXp: 30,
    });
  });

  it("never throws on a corrupted record", () => {
    const storage = memoryStorage();
    storage.data.set("nilx-one.progression.v2.0x0sky", "{not json");
    expect(readProgression("0x0sky", storage)).toBe(EMPTY_PROGRESSION);

    storage.data.set(
      "nilx-one.progression.v2.0x0sky",
      JSON.stringify({ bondXp: "forty" }),
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
      awardExperience(current, "bond", XP_ZONE_REVEALED_MANUALLY),
    );
    expect(first.bondXp).toBe(XP_ZONE_REVEALED_MANUALLY);
    expect(notifications).toBe(1);

    // A no-op change never fires a listener.
    updateProgression("0x0sky", (current) => current);
    expect(notifications).toBe(1);

    expect(progressionSnapshot("0x0sky")).toBe(first);
    unsubscribe();
  });
});
