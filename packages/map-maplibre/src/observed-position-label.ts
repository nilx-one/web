// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapAppearance,
  MapObservedPositionLabel,
} from "@nilx-one/map-contract";

export const OBSERVED_POSITION_LABEL_CLASS = "map-observed-position-label";

/** The card's live body, in CSS pixels: a whole person at a glance. */
export const LABEL_BODY_WIDTH = 30;
export const LABEL_BODY_HEIGHT = 40;

/**
 * What stands beside the card's text: the live body, its still, or nothing.
 * The world and the card take turns, so the application never asks for both.
 */
export type LabelBodyMode = "model" | "still" | "none";

/** The Dock's own easing, so the card opens the way the Dock does. */
const SPEECH_TRANSITION =
  "max-height 320ms cubic-bezier(0.2, 0, 0, 1), opacity 240ms ease, margin-top 320ms cubic-bezier(0.2, 0, 0, 1)";

/** Tall enough for three short lines, which is the most a line should run. */
const SPEECH_OPEN_MAX_HEIGHT = "64px";

export function prefersReducedMotion(document: Document): boolean {
  try {
    return (
      document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches ?? false
    );
  } catch {
    return false;
  }
}

/**
 * Every part here lays itself out with an inline `display`, which outranks the
 * `hidden` attribute's own `display: none`, so both are set together.
 */
export function setPartShown(
  element: HTMLElement,
  shown: boolean,
  display: string,
): void {
  element.hidden = !shown;
  element.style.display = shown ? display : "none";
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

  // The text is the identity; beside it stands the body the world is too far
  // out to draw — live when this host can draw it, a still when it cannot.
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

  const model = document.createElement("canvas");
  model.dataset.part = "model";
  model.setAttribute("aria-hidden", "true");
  model.style.width = `${LABEL_BODY_WIDTH}px`;
  model.style.height = `${LABEL_BODY_HEIGHT}px`;
  model.style.flex = "0 0 auto";
  setPartShown(study, false, "block");
  setPartShown(model, false, "block");

  const title = document.createElement("strong");
  title.dataset.part = "title";
  title.style.display = "block";
  title.style.fontWeight = "600";

  const subscription = document.createElement("span");
  subscription.dataset.part = "subscription";
  subscription.style.fontSize = "10px";
  subscription.style.display = "grid";
  subscription.style.maxHeight = "0px";
  subscription.style.overflow = "hidden";
  for (const tier of ["special", "exclusive"] as const) {
    const badge = document.createElement("span");
    badge.dataset.tier = tier;
    badge.textContent = tier === "special" ? "Special" : "Exclusive";
    badge.style.gridArea = "1 / 1";
    badge.style.opacity = "0";
    badge.setAttribute("aria-hidden", "true");
    subscription.append(badge);
  }

  const activity = document.createElement("span");
  activity.dataset.part = "activity";
  activity.style.display = "block";
  activity.style.fontSize = "11px";

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

  text.append(title, subscription, activity, detail, speech);
  card.append(text, model, study);
  element.append(card, connector);
  return element;
}

export function applyObservedPositionLabel(
  element: HTMLElement,
  label: MapObservedPositionLabel,
  appearance: MapAppearance,
): void {
  const palette = PALETTE[appearance];
  const changedSubject =
    element.dataset.subject !== undefined &&
    element.dataset.subject !== label.title;
  element.dataset.subject = label.title;
  const instant = changedSubject || prefersReducedMotion(element.ownerDocument);
  const card = element.querySelector<HTMLElement>('[data-part="card"]');
  const title = element.querySelector<HTMLElement>('[data-part="title"]');
  const detail = element.querySelector<HTMLElement>('[data-part="detail"]');
  const connector = element.querySelector<HTMLElement>(
    '[data-part="connector"]',
  );
  const study = element.querySelector<HTMLImageElement>('[data-part="study"]');
  const activity = element.querySelector<HTMLElement>('[data-part="activity"]');
  const speech = element.querySelector<HTMLElement>('[data-part="speech"]');

  if (card !== null) {
    card.style.background = palette.surface;
    card.style.color = palette.title;
    card.style.boxShadow = palette.shadow;
  }
  if (title !== null) {
    title.style.transition = instant ? "none" : "color 700ms ease";
    setText(title, label.title);
    title.style.color =
      label.subscriptionTier === "exclusive"
        ? appearance === "dark"
          ? "#e0caff"
          : "#602a9b"
        : palette.title;
    if (
      label.subscriptionTier === "exclusive" ||
      label.subscriptionTier === "special"
    ) {
      title.dataset.subscription = label.subscriptionTier;
      title.title =
        label.subscriptionTier === "exclusive" ? "Exclusive" : "Special";
    } else {
      delete title.dataset.subscription;
      title.removeAttribute("title");
    }
  }
  const subscription = element.querySelector<HTMLElement>(
    '[data-part="subscription"]',
  );
  if (subscription !== null) {
    const tier = label.subscriptionTier;
    const active = tier === "exclusive" || tier === "special";
    const reduced = instant;
    subscription.style.transition = reduced ? "none" : "max-height 700ms ease";
    subscription.style.maxHeight = active ? "20px" : "0px";
    subscription.setAttribute("aria-hidden", String(!active));
    for (const badge of subscription.querySelectorAll<HTMLElement>(
      "[data-tier]",
    )) {
      const selected = badge.dataset.tier === tier;
      badge.style.transition = reduced
        ? "none"
        : "opacity 700ms ease, color 700ms ease";
      badge.style.opacity = selected ? "1" : "0";
      badge.setAttribute("aria-hidden", String(!selected));
      badge.style.color =
        badge.dataset.tier === "special"
          ? appearance === "dark"
            ? "#d2b5ff"
            : "#6c39aa"
          : appearance === "dark"
            ? "#e0caff"
            : "#602a9b";
    }
  }
  if (detail !== null) {
    setText(detail, label.detail ?? "");
    setPartShown(detail, label.detail !== undefined, "block");
    detail.style.color = palette.detail;
  }
  if (activity !== null) {
    setText(activity, label.activity ?? "");
    setPartShown(activity, label.activity !== undefined, "block");
    activity.style.color = palette.detail;
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
  if (
    study !== null &&
    label.avatarUrl !== undefined &&
    study.getAttribute("src") !== label.avatarUrl
  ) {
    study.src = label.avatarUrl;
  }
}

/** The canvas the card's live body is drawn into, made once with the card. */
export function labelBodyCanvas(
  element: HTMLElement,
): HTMLCanvasElement | null {
  return element.querySelector<HTMLCanvasElement>('[data-part="model"]');
}

/**
 * Show the live body, its still, or neither. Both parts stay in the card for
 * its whole life: switching is a flag, never a new element or a new load. A
 * card with no body to show is text alone rather than a gap where one would be.
 */
export function setLabelBody(element: HTMLElement, mode: LabelBodyMode): void {
  const model = labelBodyCanvas(element);
  const study = element.querySelector<HTMLElement>('[data-part="study"]');
  if (model !== null) setPartShown(model, mode === "model", "block");
  if (study !== null) setPartShown(study, mode === "still", "block");
  element.dataset.body = mode;
}
