// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapAppearance,
  MapObservedPositionLabel,
} from "@nilx-one/map-contract";

export const OBSERVED_POSITION_LABEL_CLASS = "map-observed-position-label";

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
  card.style.borderRadius = "14px";
  card.style.padding = "8px 14px";
  card.style.textAlign = "center";
  card.style.lineHeight = "1.25";
  card.style.fontSize = "13px";

  const title = document.createElement("strong");
  title.dataset.part = "title";
  title.style.display = "block";
  title.style.fontWeight = "600";

  const detail = document.createElement("span");
  detail.dataset.part = "detail";
  detail.style.display = "block";
  detail.style.fontSize = "11px";

  const connector = document.createElement("span");
  connector.dataset.part = "connector";
  connector.style.width = "1px";
  connector.style.height = "22px";

  card.append(title, detail);
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

  if (card !== null) {
    card.style.background = palette.surface;
    card.style.color = palette.title;
    card.style.boxShadow = palette.shadow;
  }
  if (title !== null) {
    title.textContent = label.title;
    title.style.color = palette.title;
  }
  if (detail !== null) {
    detail.textContent = label.detail ?? "";
    detail.hidden = label.detail === undefined;
    detail.style.color = palette.detail;
  }
  if (connector !== null) {
    connector.style.background = palette.connector;
  }
}
