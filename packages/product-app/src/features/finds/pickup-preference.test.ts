// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PICKUP,
  PICKUP_STORAGE_KEY,
  choosePickup,
  choosePickupThreshold,
  pickupThresholdLevel,
  pickedUpRarities,
  readPickup,
} from "./pickup-preference";

afterEach(() => {
  window.localStorage.clear();
});

describe("pick-up preference", () => {
  it("picks up every rarity until told otherwise", () => {
    expect(readPickup()).toBe(DEFAULT_PICKUP);
    expect(DEFAULT_PICKUP).toBe("common,uncommon,rare,legendary");
  });

  it("keeps Core's commonest-first order whatever is toggled", () => {
    choosePickup("common", false);
    choosePickup("legendary", false);
    choosePickup("common", true);
    expect(readPickup()).toBe("common,uncommon,rare");
    expect([...pickedUpRarities(readPickup())]).toEqual([
      "common",
      "uncommon",
      "rare",
    ]);
  });

  it("can leave everything behind", () => {
    for (const rarity of ["common", "uncommon", "rare", "legendary"] as const) {
      choosePickup(rarity, false);
    }
    expect(readPickup()).toBe("");
  });

  it("maps five inclusive thresholds onto Core's canonical rarity order", () => {
    const expected = [
      "",
      "legendary",
      "rare,legendary",
      "uncommon,rare,legendary",
      DEFAULT_PICKUP,
    ];
    for (const [level, wire] of expected.entries()) {
      choosePickupThreshold(level);
      expect(readPickup()).toBe(wire);
      expect(pickupThresholdLevel(readPickup())).toBe(level);
    }
    choosePickupThreshold(5);
    expect(readPickup()).toBe(DEFAULT_PICKUP);
    choosePickupThreshold(-1);
    expect(readPickup()).toBe(DEFAULT_PICKUP);
  });

  it("recognizes sparse saved checkbox choices without silently rewriting them", () => {
    choosePickup("uncommon", false);
    const before = readPickup();
    expect(pickupThresholdLevel(before)).toBeNull();
    expect(readPickup()).toBe(before);
  });

  it("ignores a stored value with unknown codes", () => {
    window.localStorage.setItem(PICKUP_STORAGE_KEY, "common,epic");
    expect(readPickup()).toBe(DEFAULT_PICKUP);
  });
});
