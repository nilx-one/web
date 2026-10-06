// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";
import { describe, expect, it, vi } from "vitest";

import { WORKSHOP_KINDS, isWorkshop, workshopAt } from "./workshops";

function place(kind: string, name?: string): MapLandmark {
  return {
    id: `poi:${kind}:${name ?? ""}`,
    longitude: 30.5,
    latitude: 50.45,
    kind,
    ...(name === undefined ? {} : { name }),
    facts: {},
  };
}

describe("what is a repair workshop", () => {
  it("is any electronics repair or radio parts shop", () => {
    expect(isWorkshop(place("electronics_repair", "Fixlab"))).toBe(true);
    expect(isWorkshop(place("electronics_repair"))).toBe(true);
    expect(isWorkshop(place("radiotechnics", "Радіодеталі"))).toBe(true);
  });

  it("is a radio market, as Kyiv's are named in the archive", () => {
    expect(isWorkshop(place("marketplace", "Радіоринок"))).toBe(true);
    expect(isWorkshop(place("electronics", "Дарницький Радіо ринок"))).toBe(
      true,
    );
    expect(isWorkshop(place("marketplace", "Бессарабський ринок"))).toBe(false);
    expect(isWorkshop(place("electronics", "Радіомаг"))).toBe(false);
  });
});

describe("standing at one", () => {
  const fixlab = place("electronics_repair", "Fixlab");
  const renderer = { pointsNear: vi.fn(() => [place("cafe"), fixlab]) };
  const here = { longitude: 30.5, latitude: 50.45, accuracyMeters: 10 };

  it("finds the nearest workshop within a few dozen metres", () => {
    expect(workshopAt(renderer, here)).toBe(fixlab);
    expect(renderer.pointsNear).toHaveBeenCalledWith(here, 40, WORKSHOP_KINDS);
  });

  it("takes no imprecise fix and no position at all", () => {
    expect(workshopAt(renderer, { ...here, accuracyMeters: 120 })).toBe(
      undefined,
    );
    expect(workshopAt(renderer, undefined)).toBe(undefined);
    expect(workshopAt({}, here)).toBe(undefined);
  });
});
