// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  applyPinnedLandmarkLabel,
  pinnedLandmarkColor,
  CURATED_RARITY_COLORS,
  clampWeight,
  createPinnedLandmarkLabelElement,
  layoutPinnedLabels,
  pinnedCardOffset,
  pinnedLandmarkLabelZoom,
  pinnedLandmarksData,
  setPinnedLandmarkLabelShown,
  setPinnedLandmarkCardOffset,
  visiblePinnedLabels,
} from "./pinned-landmarks";

const MOTHERLAND = {
  id: "kyiv.motherland",
  longitude: 30.5636,
  latitude: 50.4267,
  kind: "monument",
  weight: 1,
  title: "Motherland Monument",
  detail: "Monument",
} as const;

describe("pinned landmarks", () => {
  it("clamps weight instead of rejecting it", () => {
    expect(clampWeight(-1)).toBe(0);
    expect(clampWeight(2)).toBe(1);
    expect(clampWeight(Number.NaN)).toBe(0);
    expect(clampWeight(0.4)).toBe(0.4);
  });

  it("names heavier landmarks from further out", () => {
    expect(pinnedLandmarkLabelZoom(1)).toBe(11);
    expect(pinnedLandmarkLabelZoom(0)).toBe(15);
    expect(pinnedLandmarkLabelZoom(0.8)).toBeLessThan(
      pinnedLandmarkLabelZoom(0.4),
    );
  });

  it("carries presentation properties only, at the landmark's own point", () => {
    const data = pinnedLandmarksData([{ ...MOTHERLAND, weight: 3 }]) as {
      features: {
        properties: Record<string, unknown>;
        geometry: { coordinates: number[] };
      }[];
    };
    expect(data.features[0]?.properties).toEqual({
      id: "kyiv.motherland",
      kind: "monument",
      weight: 1,
    });
    expect(data.features[0]?.geometry.coordinates).toEqual([30.5636, 50.4267]);
  });

  it("uses Core rarity colours without changing ordinary pins", () => {
    const rated = (rarity: "rare" | "special" | "exclusive") => ({
      ...MOTHERLAND,
      rarity,
    });
    expect(pinnedLandmarkColor(rated("rare"))).toBe(CURATED_RARITY_COLORS.rare);
    expect(pinnedLandmarkColor(rated("special"))).toBe(
      CURATED_RARITY_COLORS.special,
    );
    expect(pinnedLandmarkColor(rated("exclusive"))).toBe(
      CURATED_RARITY_COLORS.exclusive,
    );
    expect(pinnedLandmarkColor(MOTHERLAND)).not.toBe(
      CURATED_RARITY_COLORS.rare,
    );
    const data = pinnedLandmarksData([rated("special")]) as {
      features: { properties: Record<string, unknown> }[];
    };
    expect(data.features[0]?.properties.rarity).toBe("special");
  });

  it("renders the application's text and hides an absent detail", () => {
    const element = createPinnedLandmarkLabelElement(document);
    applyPinnedLandmarkLabel(element, MOTHERLAND, "light");
    expect(element.textContent).toContain("Motherland Monument");
    expect(element.dataset.landmarkId).toBe("kyiv.motherland");

    const { detail: _detail, ...bare } = MOTHERLAND;
    applyPinnedLandmarkLabel(element, bare, "dark");
    expect(
      element.querySelector<HTMLElement>('[data-part="detail"]')?.hidden,
    ).toBe(true);
  });

  it("lets the heavier card keep its place when two would overlap", () => {
    const at = (id: string, weight: number, x: number) => ({
      id,
      weight,
      title: id,
      x,
      y: 300,
    });
    const crowded = [at("light", 0.8, 210), at("heavy", 1, 200)];
    expect([...visiblePinnedLabels(crowded, 14)]).toEqual(["heavy"]);

    const apart = [at("light", 0.8, 600), at("heavy", 1, 200)];
    expect(visiblePinnedLabels(apart, 14).size).toBe(2);
    // Below the zoom its weight earns, a card stays hidden even with room.
    expect([...visiblePinnedLabels(apart, 11.2)]).toEqual(["heavy"]);
  });

  it("keeps landmark cards inside the canvas", () => {
    const element = createPinnedLandmarkLabelElement(document);
    expect(pinnedCardOffset(8, 240, 390)).toBe(124);
    expect(pinnedCardOffset(380, 240, 390)).toBe(-122);
    expect(pinnedCardOffset(200, 240, 390)).toBe(0);
    setPinnedLandmarkCardOffset(element, 124, 390);
    expect(
      element.querySelector<HTMLElement>('[data-part="card"]')?.style.transform,
    ).toBe("translateX(124px)");
    expect(
      element.querySelector<HTMLElement>('[data-part="connector"]')?.style.transform,
    ).toBe("");
  });

  it("avoids chrome and shifted label collisions", () => {
    const first = {
      id: "left",
      weight: 1,
      title: "Kyiv landmark long name",
      x: 4,
      y: 130,
    };
    const second = { ...first, id: "beside", x: 45, weight: 0.9 };
    const tooHigh = { ...first, id: "top", x: 160, y: 25 };
    const layout = layoutPinnedLabels([first, second, tooHigh], 16, {
      width: 390,
      height: 800,
      topInset: 80,
      bottomInset: 180,
    });
    expect(layout.has("left")).toBe(true);
    expect(layout.has("beside")).toBe(false);
    expect(layout.has("top")).toBe(false);
    expect((layout.get("left") ?? 0)).toBeGreaterThan(0);
  });

  it("hides a card for real despite its inline layout", () => {
    const element = createPinnedLandmarkLabelElement(document);
    setPinnedLandmarkLabelShown(element, false);
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe("none");
    setPinnedLandmarkLabelShown(element, true);
    expect(element.style.display).toBe("flex");
  });
});
