// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRendererStatus } from "@nilx-one/map-contract";

export interface MapFoundationViewModel {
  readonly tone: "neutral" | "positive" | "negative";
  readonly label: string;
  readonly detail: string;
}

// A person reading a failed map deserves the cause the renderer actually
// reported. The generic sentence stays for reasons this surface has not learned
// yet, so a new renderer failure is never presented as a known one.
function unavailableDetail(reason: string): string {
  switch (reason) {
    case "style-load-failed":
      return "The versioned self-hosted map style is not published yet.";
    case "basemap-load-failed":
      return "The versioned self-hosted basemap archive could not be read.";
    case "style-load-timeout":
      return "The self-hosted map style did not answer in time.";
    case "first-paint-timeout":
      return "The map style loaded, but the renderer never drew a first frame.";
    case "webgl-unavailable":
      return "This browser could not create the WebGL2 context the map needs.";
    case "webgl-context-lost":
      return "This browser dropped the map's WebGL context.";
    case "container-zero-size":
      return "The map surface resolved to zero size on this client.";
    case "renderer-init-failed":
      return "The map renderer could not be created on this client.";
    default:
      return "The geographic renderer could not start on this client.";
  }
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
        detail: unavailableDetail(status.reason),
      };
  }
}
