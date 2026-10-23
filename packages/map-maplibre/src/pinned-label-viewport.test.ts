// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  createPinnedLandmarkLabelElement,
  layoutPinnedLabels,
  pinnedCardOffset,
  setPinnedLandmarkCardOffset,
} from "./pinned-landmarks";

describe("pinned viewport layout", () => {
  it("keeps the connector in place", () => {
    const root = createPinnedLandmarkLabelElement(document);
    setPinnedLandmarkCardOffset(root, 124, 390);
    const card = root.querySelector<HTMLElement>("[data-part=card]");
    const pin = root.querySelector<HTMLElement>("[data-part=connector]");
    expect(card?.style.transform).toBe("translateX(124px)");
    expect(pin?.style.transform).toBe("");
    expect(pinnedCardOffset(8, 240, 390)).toBe(124);
    expect(pinnedCardOffset(380, 240, 390)).toBe(-122);
    expect(pinnedCardOffset(200, 240, 390)).toBe(0);
  });

  it("rejects overlapping or obscured labels", () => {
    const a = { id: "a", weight: 1, title: "Lavra", x: 4, y: 130 };
    const b = { ...a, id: "b", weight: 0.9, x: 25 };
    const c = { ...a, id: "c", x: 200, y: 10 };
    const viewport = { width: 390, height: 800, topInset: 80 };
    const layout = layoutPinnedLabels([a, b, c], 16, viewport);
    expect(layout.has("a")).toBe(true);
    expect(layout.has("b")).toBe(false);
    expect(layout.has("c")).toBe(false);
    expect((layout.get("a") ?? 0)).toBeGreaterThan(0);
  });
});
