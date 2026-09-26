// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  applyPinnedLandmarkLabel,
  clampWeight,
  createPinnedLandmarkLabelElement,
  pinnedLandmarkLabelZoom,
  pinnedLandmarksData,
  setPinnedLandmarkLabelShown,
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

  it("hides a card for real despite its inline layout", () => {
    const element = createPinnedLandmarkLabelElement(document);
    setPinnedLandmarkLabelShown(element, false);
    expect(element.hidden).toBe(true);
    expect(element.style.display).toBe("none");
    setPinnedLandmarkLabelShown(element, true);
    expect(element.style.display).toBe("flex");
  });
});
