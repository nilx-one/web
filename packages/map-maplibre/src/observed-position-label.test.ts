// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { avatarPreviewUrl } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  applyObservedPositionLabel,
  createObservedPositionLabelElement,
  labelBodyCanvas,
  setLabelBody,
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
    setLabelBody(element, "still");

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

  it("says what the body is doing beside how far away it is", () => {
    const { element, part } = label();

    applyObservedPositionLabel(
      element,
      { title: "0x0sky", activity: "Walking", detail: "40m from this device" },
      "light",
    );

    expect(part("activity")?.textContent).toBe("Walking");
    expect(part("activity")?.hidden).toBe(false);
    applyObservedPositionLabel(element, { title: "0x0sky" }, "light");
    expect(part("activity")?.hidden).toBe(true);
  });

  // The live body and its still are both made with the card, once; showing
  // one or the other is a flag on parts that never leave it.
  it("takes turns between the live body and its still without new parts", () => {
    const { element, part } = label();
    const canvas = labelBodyCanvas(element);

    setLabelBody(element, "model");
    expect(canvas?.hidden).toBe(false);
    expect(part("study")?.hidden).toBe(true);

    setLabelBody(element, "still");
    expect(canvas?.hidden).toBe(true);
    expect(part("study")?.hidden).toBe(false);

    setLabelBody(element, "none");
    expect(canvas?.hidden).toBe(true);
    expect(part("study")?.hidden).toBe(true);
    expect(labelBodyCanvas(element)).toBe(canvas);
  });

  it("is text alone when there is no study to show", () => {
    const { element, part } = label();

    applyObservedPositionLabel(element, { title: "0x0sky" }, "light");

    expect((part("study") as HTMLImageElement).hidden).toBe(true);
    expect(part("detail")?.hidden).toBe(true);
    // `hidden` alone loses to the inline layout; the part has to be gone.
    expect(part("study")?.style.display).toBe("none");
    expect(part("detail")?.style.display).toBe("none");
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

it("shows subscription status without a visible body and clears reused labels", () => {
  const element = createObservedPositionLabelElement(document);
  applyObservedPositionLabel(
    element,
    { title: "0x0sky", subscriptionTier: "exclusive" },
    "dark",
  );
  const title = element.querySelector<HTMLElement>('[data-part="title"]')!;
  const badge = element.querySelector<HTMLElement>(
    '[data-part="subscription"]',
  )!;
  expect(title.dataset.subscription).toBe("exclusive");
  expect(badge.querySelector('[aria-hidden="false"]')?.textContent).toBe(
    "Exclusive",
  );
  const exclusiveColor = title.style.color;
  applyObservedPositionLabel(
    element,
    { title: "0x0sky", subscriptionTier: "special" },
    "dark",
  );
  expect(title.style.color).not.toBe(exclusiveColor);
  expect(badge.querySelector('[aria-hidden="false"]')?.textContent).toBe(
    "Special",
  );
  applyObservedPositionLabel(element, { title: "0x1other" }, "light");
  expect(title.dataset.subscription).toBeUndefined();
  expect(title.hasAttribute("title")).toBe(false);
  expect(badge.style.maxHeight).toBe("0px");
  expect(badge.getAttribute("aria-hidden")).toBe("true");
  expect(badge.style.transition).toBe("none");
});
