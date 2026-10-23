// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createPinnedLandmarkLabelElement,
  layoutPinnedLabels,
  pinnedCardOffset,
  setPinnedLandmarkCardOffset,
} from "./pinned-landmarks";

describe("pinned landmark labels inside a mobile map", () => {
  it("moves the card, not its geographic connector", () => {
    const root = createPinnedLandmarkLabelElement(document);
    setPinnedLandmarkCardOffset(root, 124, 390);
    const card = root.querySelector<HTMLElement>("[data-part=card]");
    const connector = root.querySelector<HTMLElement>("[data-part=connector]");
    expect(card?.style.transform).toBe("translateX(124px)");
    expect(connector?.style.transform).toBe("");
    expect(pinnedCardOffset(8, 240, 390)).toBe(124);
    expect(pinnedCardOffset(380, 240, 390)).toBe(-122);
    expect(pinnedCardOffset(200, 240, 390)).toBe(0);
  });

  it("keeps competing or obscured cards hidden", () => {
    const first = { id: "left", weight: 1, title: "Lavra", x: 4, y: 130 };
    const second = { ...first, id: "next", weight: 0.9, x: 25 };
    const top = { ...first, id: "top", x: 200, y: 10 };
    const viewport = { width: 390, height: 800, topInset: 80 };
    const layout = layoutPinnedLabels([first, second, top], 16, viewport);
    expect(layout.has("left")).toBe(true);
    expect(layout.has("next")).toBe(false);
    expect(layout.has("top")).toBe(false);
    expect((layout.get("left") ?? 0)).toBeGreaterThan(0);
  });
});
