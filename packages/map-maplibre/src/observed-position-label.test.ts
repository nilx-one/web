// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { avatarPreviewUrl } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  applyObservedPositionLabel,
  createObservedPositionLabelElement,
} from "./observed-position-label";

function label() {
  const element = createObservedPositionLabelElement(document);
  const part = (name: string) =>
    element.querySelector<HTMLElement>(`[data-part="${name}"]`);
  return { element, part };
}

describe("the observed position card", () => {
  // The card is what is left once a body is too far away to read, so it has to
  // carry the same body as a still — beside the identity, not instead of it.
  it("shows the study beside the identity it belongs to", () => {
    const { element, part } = label();
    const url = avatarPreviewUrl("dasha-study");

    applyObservedPositionLabel(
      element,
      { title: "0x0sky", detail: "This device", avatarUrl: url },
      "light",
    );

    const study = part("study") as HTMLImageElement;
    expect(study.hidden).toBe(false);
    expect(study.getAttribute("src")).toBe(url);
    expect(part("title")?.textContent).toBe("0x0sky");
    expect(part("detail")?.textContent).toBe("This device");
    // Text first, still second: the still reads as what the identity looks
    // like, not as a separate thing standing next to it.
    const card = part("card");
    expect(card?.firstElementChild).toBe(part("text"));
    expect(card?.lastElementChild).toBe(study);
  });

  it("is text alone when there is no study to show", () => {
    const { element, part } = label();

    applyObservedPositionLabel(element, { title: "0x0sky" }, "light");

    expect((part("study") as HTMLImageElement).hidden).toBe(true);
    expect(part("detail")?.hidden).toBe(true);
  });

  // Re-applying the same card must not restart the image download.
  it("leaves an unchanged still alone", () => {
    const { element, part } = label();
    const url = avatarPreviewUrl("kai-study");
    const study = part("study") as HTMLImageElement;

    applyObservedPositionLabel(
      element,
      { title: "0x0sky", avatarUrl: url },
      "light",
    );
    const first = study.getAttribute("src");
    applyObservedPositionLabel(
      element,
      { title: "0x0sky", avatarUrl: url },
      "dark",
    );

    expect(study.getAttribute("src")).toBe(first);
  });

  it("dresses the card for the appearance it is drawn on", () => {
    const { element, part } = label();

    applyObservedPositionLabel(element, { title: "0x0sky" }, "dark");
    const dark = part("card")?.style.background;
    applyObservedPositionLabel(element, { title: "0x0sky" }, "light");

    expect(part("card")?.style.background).not.toBe(dark);
  });
});
