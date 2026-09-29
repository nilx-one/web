// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";
import {
  Map as MapLibreMap,
  type MapOptions,
  type StyleSpecification,
} from "maplibre-gl";

import {
  FOG_PALETTES,
  requireFogPalette,
  requireFogZones,
  styleAppearance,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
import { cellAtLngLat, type CellTap } from "./pick";
import { createShadeLayer, type PageVisibility } from "./shade-layer";

export interface ShadeRuntime {
  readonly store: PresenceStore;
  readonly source: ShadeSource;
}

export interface ShadeMapFactoryOptions {
  readonly runtime: Promise<ShadeRuntime | null>;
  readonly anchor: { readonly lng: number; readonly lat: number };
  readonly onCellTap?: (tap: CellTap) => void | Promise<void>;
  /**
   * How the fog is lit under each published appearance. The style's own
   * `nilx-one:appearance` metadata picks one, so a style swap relights it.
   */
  readonly fogPalettes?: Readonly<Record<"light" | "dark", FogPalette>>;
  /** Stretches of fog wearing their own palette. */
  readonly fogZones?: readonly FogZone[];
  /** Whether this person asked not to be moved; the mist then holds still. */
  readonly prefersReducedMotion?: () => boolean;
  /**
   * Whether anyone can see the page, for a host whose lifecycle the document
   * does not report. Drifting mist asks for no frame while it is hidden.
   */
  readonly pageVisibility?: PageVisibility;
}

function defaultPrefersReducedMotion(): boolean {
  try {
    return (
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false
    );
  } catch {
    return false;
  }
}

/**
 * Concrete MapLibre composition seam. The product still receives MapRenderer;
 * no raw MapLibre instance escapes into product or host code.
 */
export function createShadeMapFactory(
  options: ShadeMapFactoryOptions,
): (mapOptions: MapOptions) => MapLibreMap {
  // The layer is built later, inside the journal's promise, where a bad
  // palette or zone would only ever surface as an unhandled rejection and a
  // map with no fog. The host that composed them hears about it here.
  const palettes = options.fogPalettes ?? FOG_PALETTES;
  requireFogPalette(palettes.light, "fogPalettes.light");
  requireFogPalette(palettes.dark, "fogPalettes.dark");
  const zones = options.fogZones ?? [];
  requireFogZones(zones);
  const stillness = options.prefersReducedMotion ?? defaultPrefersReducedMotion;

  return (mapOptions) => {
    const map = new MapLibreMap(mapOptions);
    let removed = false;

    void options.runtime.then((runtime) => {
      if (runtime === null || removed) return;
      const layer = createShadeLayer({
        source: runtime.source,
        store: runtime.store,
        anchor: options.anchor,
        // Keep unrevealed geography as fog rather than a translucent wash:
        // basemap details must not remain readable through the veil. A pale
        // mist over dark building faces gives them away sooner than the old
        // black veil did, so it is denser than the 0.92 that veil needed.
        shadeAlpha: 0.97,
        palette:
          palettes[
            styleAppearance(map.getStyle() as StyleSpecification | undefined)
          ],
        zones,
        motion: stillness() ? "still" : "drift",
        ...(options.pageVisibility === undefined
          ? {}
          : { visibility: options.pageVisibility }),
        ...(options.onCellTap === undefined
          ? {}
          : { onCellTap: options.onCellTap }),
      });
      const ensureLayer = (): void => {
        if (removed) return;
        // A style swap is an appearance swap: the fog takes its light from
        // whichever style it now sits in. Before a style has loaded MapLibre
        // has none to answer with.
        const style = map.getStyle() as StyleSpecification | undefined;
        if (style !== undefined) {
          layer.setPalette(palettes[styleAppearance(style)]);
        }
        if (!map.isStyleLoaded() || map.getLayer(layer.id) !== undefined) {
          return;
        }
        const firstSymbol = map
          .getStyle()
          .layers?.find((candidate) => candidate.type === "symbol")?.id;
        map.addLayer(layer, firstSymbol);
      };

      map.on("styledata", ensureLayer);
      map.on("load", ensureLayer);
      ensureLayer();
    });

    map.on("remove", () => {
      removed = true;
    });

    return map;
  };
}

/**
 * Whether this device has revealed the ground at a point, for a renderer that
 * reports taps into the fog. It answers from the same lit-cell membership the
 * shade layer draws, and says "revealed" while the journal is still loading
 * or could not load at all — no fog is drawn then, so none is claimed.
 */
export function createGroundRevealed(
  runtime: Promise<ShadeRuntime | null>,
): (point: {
  readonly longitude: number;
  readonly latitude: number;
}) => boolean {
  let source: ShadeSource | undefined;
  void runtime.then(
    (resolved) => {
      source = resolved?.source;
    },
    () => undefined,
  );
  return (point) =>
    source === undefined ||
    source.isLit(cellAtLngLat({ lng: point.longitude, lat: point.latitude }));
}
