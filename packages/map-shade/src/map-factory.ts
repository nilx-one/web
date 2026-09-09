// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";
import { Map as MapLibreMap, type MapOptions } from "maplibre-gl";

import type { CellTap } from "./pick";
import { createShadeLayer } from "./shade-layer";

export interface ShadeRuntime {
  readonly store: PresenceStore;
  readonly source: ShadeSource;
}

export interface ShadeMapFactoryOptions {
  readonly runtime: Promise<ShadeRuntime | null>;
  readonly anchor: { readonly lng: number; readonly lat: number };
  readonly onCellTap?: (tap: CellTap) => void | Promise<void>;
}

/**
 * Concrete MapLibre composition seam. The product still receives MapRenderer;
 * no raw MapLibre instance escapes into product or host code.
 */
export function createShadeMapFactory(
  options: ShadeMapFactoryOptions,
): (mapOptions: MapOptions) => MapLibreMap {
  return (mapOptions) => {
    const map = new MapLibreMap(mapOptions);
    let removed = false;

    void options.runtime.then((runtime) => {
      if (runtime === null || removed) return;
      const layer = createShadeLayer({
        source: runtime.source,
        store: runtime.store,
        anchor: options.anchor,
        ...(options.onCellTap === undefined
          ? {}
          : { onCellTap: options.onCellTap }),
      });
      const ensureLayer = (): void => {
        if (
          removed ||
          !map.isStyleLoaded() ||
          map.getLayer(layer.id) !== undefined
        ) {
          return;
        }
        const firstSymbol = map.getStyle().layers?.find(
          (candidate) => candidate.type === "symbol",
        )?.id;
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
