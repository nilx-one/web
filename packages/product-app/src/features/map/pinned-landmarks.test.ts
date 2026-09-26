// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { translate } from "../../shell/localization";
import { KYIV_PINNED_LANDMARKS, pinnedLandmarks } from "./pinned-landmarks";

describe("Kyiv pinned landmarks", () => {
  it("keeps every id unique", () => {
    const ids = KYIV_PINNED_LANDMARKS.map((seed) => seed.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("sites every landmark inside Kyiv, never at a swapped lng/lat", () => {
    for (const seed of KYIV_PINNED_LANDMARKS) {
      expect(seed.longitude).toBeGreaterThan(30.2);
      expect(seed.longitude).toBeLessThan(30.9);
      expect(seed.latitude).toBeGreaterThan(50.3);
      expect(seed.latitude).toBeLessThan(50.6);
      expect(seed.weight).toBeGreaterThanOrEqual(0);
      expect(seed.weight).toBeLessThanOrEqual(1);
    }
  });

  it("names each landmark in the reader's language", () => {
    const uk = pinnedLandmarks((key) => translate("uk-UA", key));
    const en = pinnedLandmarks((key) => translate("en", key));
    expect(uk.find((l) => l.id === "kyiv.motherland")?.title).toBe(
      "Батьківщина-Мати",
    );
    expect(en.find((l) => l.id === "kyiv.motherland")?.title).toBe(
      "Motherland Monument",
    );
    for (const landmark of uk) {
      expect(landmark.title).not.toMatch(/^landmark\./);
      expect(landmark.detail).not.toMatch(/^landmark\./);
    }
  });
});
