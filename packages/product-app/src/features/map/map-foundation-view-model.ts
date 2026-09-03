// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRendererStatus } from "@nilx-one/map-contract";

export interface MapFoundationViewModel {
  readonly tone: "neutral" | "positive" | "negative";
  readonly label: string;
  readonly detail: string;
}

export function createMapFoundationViewModel(
  status: MapRendererStatus,
): MapFoundationViewModel {
  switch (status.kind) {
    case "unmounted":
      return {
        tone: "neutral",
        label: "Map idle",
        detail: "The geographic renderer has not mounted yet.",
      };
    case "loading":
      return {
        tone: "neutral",
        label: "Loading map",
        detail: "Loading the self-hosted 0x1 map style.",
      };
    case "ready":
      return {
        tone: "positive",
        label: "Map ready",
        detail: "MapLibre is rendering the geographic substrate.",
      };
    case "unavailable":
      return {
        tone: "negative",
        label: "Map unavailable",
        detail:
          status.reason === "style-load-failed"
            ? "The versioned self-hosted map style is not published yet."
            : "The geographic renderer could not start on this client.",
      };
  }
}
