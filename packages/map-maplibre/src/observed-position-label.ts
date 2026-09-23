// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapAppearance,
  MapObservedPositionLabel,
} from "@nilx-one/map-contract";

export const OBSERVED_POSITION_LABEL_CLASS = "map-observed-position-label";

/** The Dock's own easing, so the card opens the way the Dock does. */
const SPEECH_TRANSITION =
  "max-height 320ms cubic-bezier(0.2, 0, 0, 1), opacity 240ms ease, margin-top 320ms cubic-bezier(0.2, 0, 0, 1)";

/** Tall enough for three short lines, which is the most a line should run. */
const SPEECH_OPEN_MAX_HEIGHT = "64px";

function prefersReducedMotion(document: Document): boolean {
  try {
    return (
      document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches ?? false
    );
  } catch {
    return false;
  }
}

function setText(element: HTMLElement, value: string): void {
  // A label is re-applied every frame an Avaia walks; writing the same text
  // again would still be a DOM mutation, and an announcement for the live one.
  if (element.textContent !== value) element.textContent = value;
}

interface LabelPalette {
  readonly surface: string;
  readonly title: string;
  readonly detail: string;
  readonly connector: string;
  readonly shadow: string;
}

const PALETTE: Readonly<Record<MapAppearance, LabelPalette>> = {
  light: {
    surface: "#ffffff",
    title: "#1d282c",
    detail: "#5d6b70",
    connector: "#37d7e5",
    shadow: "0 6px 18px rgba(20, 45, 52, 0.16)",
  },
  dark: {
    surface: "#0f1a1e",
    title: "#e8f4f6",
    detail: "#8fa3a9",
    connector: "#37d7e5",
    shadow: "0 6px 18px rgba(0, 0, 0, 0.5)",
  },
};

/**
 * The callout is DOM rather than a MapLibre symbol layer: the published style
 * serves no same-origin glyph payload yet, and a real element keeps the text
 * selectable and inspectable instead of trapping it in the canvas.
 */
export function createObservedPositionLabelElement(
  document: Document,
): HTMLElement {
  const element = document.createElement("div");
  element.className = OBSERVED_POSITION_LABEL_CLASS;
  element.style.display = "flex";
  element.style.flexDirection = "column";
  element.style.alignItems = "center";
  element.style.pointerEvents = "none";
  element.style.userSelect = "none";

  const card = document.createElement("div");
  card.dataset.part = "card";
  card.style.display = "flex";
  card.style.alignItems = "center";
  card.style.gap = "10px";
  card.style.borderRadius = "14px";
  card.style.padding = "8px 14px";
  card.style.lineHeight = "1.25";
  card.style.fontSize = "13px";

  // The text is the identity; the still is the body it would be standing in if
  // the world were close enough to see one.
  const text = document.createElement("span");
  text.dataset.part = "text";
  text.style.display = "block";
  text.style.textAlign = "left";

  const study = document.createElement("img");
  study.dataset.part = "study";
  study.alt = "";
  study.decoding = "async";
  study.style.display = "block";
  study.style.width = "28px";
  study.style.height = "28px";
  study.style.objectFit = "contain";
  study.style.flex = "0 0 auto";

  const title = document.createElement("strong");
  title.dataset.part = "title";
  title.style.display = "block";
  title.style.fontWeight = "600";

  const detail = document.createElement("span");
  detail.dataset.part = "detail";
  detail.style.display = "block";
  detail.style.fontSize = "11px";

  // What the body is saying to itself. It lives inside the card rather than in
  // a bubble of its own, and the card opens to carry it the way the Dock opens
  // into its next screen: the height travels, the line fades in behind it.
  const speech = document.createElement("span");
  speech.dataset.part = "speech";
  speech.style.display = "block";
  speech.style.maxWidth = "220px";
  speech.style.maxHeight = "0px";
  speech.style.overflow = "hidden";
  speech.style.opacity = "0";
  speech.style.fontSize = "12px";
  speech.style.fontStyle = "italic";
  speech.style.whiteSpace = "normal";
  // The map is not read by assistive technology, so the application announces
  // the line itself; here it is only drawn, and drawn still when asked to be.
  speech.style.transition = prefersReducedMotion(document)
    ? "none"
    : SPEECH_TRANSITION;

  const connector = document.createElement("span");
  connector.dataset.part = "connector";
  connector.style.width = "1px";
  connector.style.height = "22px";

  text.append(title, detail, speech);
  card.append(text, study);
  element.append(card, connector);
  return element;
}

export function applyObservedPositionLabel(
  element: HTMLElement,
  label: MapObservedPositionLabel,
  appearance: MapAppearance,
): void {
  const palette = PALETTE[appearance];
  const card = element.querySelector<HTMLElement>('[data-part="card"]');
  const title = element.querySelector<HTMLElement>('[data-part="title"]');
  const detail = element.querySelector<HTMLElement>('[data-part="detail"]');
  const connector = element.querySelector<HTMLElement>(
    '[data-part="connector"]',
  );
  const study = element.querySelector<HTMLImageElement>('[data-part="study"]');
  const speech = element.querySelector<HTMLElement>('[data-part="speech"]');

  if (card !== null) {
    card.style.background = palette.surface;
    card.style.color = palette.title;
    card.style.boxShadow = palette.shadow;
  }
  if (title !== null) {
    setText(title, label.title);
    title.style.color = palette.title;
  }
  if (detail !== null) {
    setText(detail, label.detail ?? "");
    detail.hidden = label.detail === undefined;
    detail.style.color = palette.detail;
  }
  if (connector !== null) {
    connector.style.background = palette.connector;
  }
  if (speech !== null) {
    const speaking = label.speech !== undefined && label.speech.length > 0;
    // The last line stays in place while the card closes over it, so closing
    // reads as the card settling rather than the words vanishing first.
    if (speaking) setText(speech, label.speech ?? "");
    speech.style.color = palette.title;
    speech.style.maxHeight = speaking ? SPEECH_OPEN_MAX_HEIGHT : "0px";
    speech.style.opacity = speaking ? "1" : "0";
    speech.style.marginTop = speaking ? "4px" : "0px";
    element.dataset.speaking = speaking ? "true" : "false";
  }
  if (study !== null) {
    // A card with no study to show is text alone rather than a gap where a
    // body would be: nothing is drawn for a body that was never chosen.
    study.hidden = label.avatarUrl === undefined;
    if (
      label.avatarUrl !== undefined &&
      study.getAttribute("src") !== label.avatarUrl
    ) {
      study.src = label.avatarUrl;
    }
  }
}
