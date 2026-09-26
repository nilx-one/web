// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapAppearance,
  MapPinnedLandmark,
  MapPinnedLandmarkKind,
} from "@nilx-one/map-contract";

export const PINNED_LANDMARKS_SOURCE_ID = "pinned-landmarks";
export const PINNED_LANDMARKS_GLOW_LAYER_ID = "pinned-landmarks-glow";
export const PINNED_LANDMARKS_POINT_LAYER_ID = "pinned-landmarks-point";
export const PINNED_LANDMARK_LABEL_CLASS = "map-pinned-landmark-label";

/**
 * Built things share the observed position's accent, so a landmark reads as
 * part of the same spatial language; green ground is green, which is the
 * whole of the map's "greening" for now.
 */
export const PINNED_LANDMARK_COLORS: Readonly<
  Record<MapPinnedLandmarkKind, string>
> = {
  monument: "#37d7e5",
  civic: "#37d7e5",
  sacred: "#e3be62",
  nature: "#4ccf8a",
};

/** The zoom a weight-1 landmark is named from, and a weight-0 one. */
const LABEL_ZOOM_HEAVIEST = 11;
const LABEL_ZOOM_LIGHTEST = 15;

export function clampWeight(weight: number): number {
  if (!Number.isFinite(weight)) return 0;
  return Math.min(1, Math.max(0, weight));
}

/**
 * Heavier landmarks keep their card further out, so the city view names only
 * the few that anchor it and a street view names everything around.
 */
export function pinnedLandmarkLabelZoom(weight: number): number {
  return (
    LABEL_ZOOM_LIGHTEST -
    clampWeight(weight) * (LABEL_ZOOM_LIGHTEST - LABEL_ZOOM_HEAVIEST)
  );
}

export interface PinnedLabelCandidate {
  readonly id: string;
  readonly weight: number;
  readonly title: string;
  readonly detail?: string;
  /** The landmark's own point on screen, which the card stands over. */
  readonly x: number;
  readonly y: number;
}

const CONNECTOR_PX = 14;
const LABEL_GAP_PX = 4;

/**
 * An estimate, not a measurement: reading real layout for every card on every
 * zoom frame would thrash it, and a few pixels either way only moves where a
 * lighter card steps back.
 */
function estimatedCardSize(candidate: PinnedLabelCandidate): {
  width: number;
  height: number;
} {
  const titleWidth = candidate.title.length * 7;
  const detailWidth = (candidate.detail?.length ?? 0) * 5.8;
  return {
    width: Math.max(titleWidth, detailWidth) + 20,
    height: candidate.detail === undefined ? 24 : 36,
  };
}

/**
 * Which cards to show at a zoom. A card shows once its weight has earned the
 * zoom, and heavier landmarks claim their space first: a lighter card that
 * would overlap one already shown steps back until the map zooms in far
 * enough to part them.
 */
export function visiblePinnedLabels(
  candidates: readonly PinnedLabelCandidate[],
  zoom: number,
): ReadonlySet<string> {
  const shown = new Set<string>();
  const taken: { l: number; t: number; r: number; b: number }[] = [];
  const ordered = [...candidates].sort(
    (a, b) => clampWeight(b.weight) - clampWeight(a.weight),
  );
  for (const candidate of ordered) {
    if (zoom < pinnedLandmarkLabelZoom(candidate.weight)) continue;
    const { width, height } = estimatedCardSize(candidate);
    const box = {
      l: candidate.x - width / 2 - LABEL_GAP_PX,
      r: candidate.x + width / 2 + LABEL_GAP_PX,
      t: candidate.y - CONNECTOR_PX - height - LABEL_GAP_PX,
      b: candidate.y - CONNECTOR_PX + LABEL_GAP_PX,
    };
    const overlaps = taken.some(
      (other) =>
        box.l < other.r &&
        box.r > other.l &&
        box.t < other.b &&
        box.b > other.t,
    );
    if (overlaps) continue;
    taken.push(box);
    shown.add(candidate.id);
  }
  return shown;
}

/**
 * The card lays itself out with an inline `display`, which outranks the
 * `hidden` attribute's own `display: none`, so both are set together.
 */
export function setPinnedLandmarkLabelShown(
  element: HTMLElement,
  shown: boolean,
): void {
  element.hidden = !shown;
  element.style.display = shown ? "flex" : "none";
}

export function pinnedLandmarksData(
  landmarks: readonly MapPinnedLandmark[],
): Record<string, unknown> {
  return {
    type: "FeatureCollection",
    features: landmarks.map((landmark) => ({
      type: "Feature",
      properties: {
        id: landmark.id,
        kind: landmark.kind,
        weight: clampWeight(landmark.weight),
      },
      geometry: {
        type: "Point",
        coordinates: [landmark.longitude, landmark.latitude],
      },
    })),
  };
}

export function pinnedLandmarksSource(
  landmarks: readonly MapPinnedLandmark[],
): Record<string, unknown> {
  return { type: "geojson", data: pinnedLandmarksData(landmarks) };
}

function colorByKind(): unknown {
  return [
    "match",
    ["get", "kind"],
    "sacred",
    PINNED_LANDMARK_COLORS.sacred,
    "nature",
    PINNED_LANDMARK_COLORS.nature,
    PINNED_LANDMARK_COLORS.monument,
  ];
}

/**
 * A soft halo whose reach grows with weight, and a small solid point at the
 * exact coordinate — the observed position's own vocabulary, without its
 * accuracy ring, since a landmark's position is not an estimate. Both lie
 * flat on the ground, like the observed position's circles.
 */
export function pinnedLandmarksLayers(): readonly Record<string, unknown>[] {
  const weight = ["get", "weight"];
  return [
    {
      id: PINNED_LANDMARKS_GLOW_LAYER_ID,
      type: "circle",
      source: PINNED_LANDMARKS_SOURCE_ID,
      paint: {
        "circle-color": colorByKind(),
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          ["+", 4, ["*", 10, weight]],
          16,
          ["+", 12, ["*", 26, weight]],
        ],
        "circle-blur": 1,
        "circle-opacity": 0.45,
        "circle-pitch-alignment": "map",
      },
    },
    {
      id: PINNED_LANDMARKS_POINT_LAYER_ID,
      type: "circle",
      source: PINNED_LANDMARKS_SOURCE_ID,
      paint: {
        "circle-color": colorByKind(),
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 16, 5],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 1,
        "circle-pitch-alignment": "map",
      },
    },
  ];
}

interface LabelPalette {
  readonly surface: string;
  readonly title: string;
  readonly detail: string;
  readonly shadow: string;
}

const PALETTE: Readonly<Record<MapAppearance, LabelPalette>> = {
  light: {
    surface: "rgba(255, 255, 255, 0.92)",
    title: "#1d282c",
    detail: "#5d6b70",
    shadow: "0 4px 12px rgba(20, 45, 52, 0.12)",
  },
  dark: {
    surface: "rgba(15, 26, 30, 0.92)",
    title: "#e8f4f6",
    detail: "#8fa3a9",
    shadow: "0 4px 12px rgba(0, 0, 0, 0.45)",
  },
};

/**
 * A smaller sibling of the observed position's card: it names a place rather
 * than a body, so it carries no study and no speech, and it steps back in size
 * so the Bond's own card stays the one the eye finds first.
 */
export function createPinnedLandmarkLabelElement(
  document: Document,
): HTMLElement {
  const element = document.createElement("div");
  element.className = PINNED_LANDMARK_LABEL_CLASS;
  element.style.display = "flex";
  element.style.flexDirection = "column";
  element.style.alignItems = "center";
  element.style.pointerEvents = "none";
  element.style.userSelect = "none";

  const card = document.createElement("div");
  card.dataset.part = "card";
  card.style.borderRadius = "10px";
  card.style.padding = "4px 10px";
  card.style.lineHeight = "1.2";
  card.style.whiteSpace = "nowrap";

  const title = document.createElement("strong");
  title.dataset.part = "title";
  title.style.display = "block";
  title.style.fontSize = "12px";
  title.style.fontWeight = "600";

  const detail = document.createElement("span");
  detail.dataset.part = "detail";
  detail.style.display = "block";
  detail.style.fontSize = "10px";

  const connector = document.createElement("span");
  connector.dataset.part = "connector";
  connector.style.width = "1px";
  connector.style.height = "14px";

  card.append(title, detail);
  element.append(card, connector);
  return element;
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value;
}

export function applyPinnedLandmarkLabel(
  element: HTMLElement,
  landmark: MapPinnedLandmark,
  appearance: MapAppearance,
): void {
  const palette = PALETTE[appearance];
  element.dataset.landmarkId = landmark.id;
  element.dataset.kind = landmark.kind;
  const card = element.querySelector<HTMLElement>('[data-part="card"]');
  const title = element.querySelector<HTMLElement>('[data-part="title"]');
  const detail = element.querySelector<HTMLElement>('[data-part="detail"]');
  const connector = element.querySelector<HTMLElement>(
    '[data-part="connector"]',
  );
  if (card !== null) {
    card.style.background = palette.surface;
    card.style.boxShadow = palette.shadow;
  }
  if (title !== null) {
    setText(title, landmark.title);
    title.style.color = palette.title;
  }
  if (detail !== null) {
    setText(detail, landmark.detail ?? "");
    detail.hidden = landmark.detail === undefined;
    detail.style.color = palette.detail;
  }
  if (connector !== null) {
    connector.style.background = PINNED_LANDMARK_COLORS[landmark.kind];
  }
}
