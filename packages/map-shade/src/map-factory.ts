// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";
import {
  Map as MapLibreMap,
  type MapOptions,
  type StyleSpecification,
  type CanvasSource,
  type MapMouseEvent,
} from "maplibre-gl";

import {
  FOG_PALETTES,
  requireFogPalette,
  requireFogZones,
  styleAppearance,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
import { cellAtLngLat, createTapHandler, type CellTap } from "./pick";
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

    let dispose: (() => void) | undefined;
    void options.runtime.then(
      (runtime) => {
        if (runtime === null || removed) return;
        try {
          const sourceId = "nilx-one-presence-shade-canvas";
          let publishing = false;
          const pause = () => {
            (map.getSource(sourceId) as CanvasSource | undefined)?.pause();
            publishing = false;
          };
          const publish = () => {
            if (removed) return;
            const source = map.getSource(sourceId) as CanvasSource | undefined;
            if (source === undefined) return;
            // Keep the canvas active through one render so terrain's drape cache
            // sees the update. Static fog never drives an endless map repaint.
            source.play();
            if (!publishing) {
              publishing = true;
              map.once("render", pause);
            }
          };
          const layer = createShadeLayer({
            source: runtime.source,
            store: runtime.store,
            anchor: options.anchor,
            shadeAlpha: 0.97,
            palette:
              palettes[
                styleAppearance(
                  map.getStyle() as StyleSpecification | undefined,
                )
              ],
            zones,
            motion: stillness() ? "still" : "drift",
            ...(options.pageVisibility === undefined
              ? {}
              : { visibility: options.pageVisibility }),
            onFrame: publish,
            onError: (error) => {
              if (!removed) map.fire("error", { error });
            },
          });
          const tap = createTapHandler({
            source: runtime.source,
            store: runtime.store,
          });
          const onClick = (event: MapMouseEvent) => {
            if (options.onCellTap === undefined) return;
            void tap(event.lngLat)
              .then((hit) => {
                if (hit !== null) return options.onCellTap?.(hit);
                return undefined;
              })
              .catch(() => {
                if (!removed)
                  map.fire("error", {
                    error: new Error("Presence cell could not be opened"),
                  });
              });
          };
          let ensuring = false;
          const ensureLayer = () => {
            if (removed || ensuring) return;
            ensuring = true;
            try {
              const style = map.getStyle() as StyleSpecification | undefined;
              if (style !== undefined)
                layer.setPalette(palettes[styleAppearance(style)]);
              if (!map.isStyleLoaded()) return;
              if (map.getSource(sourceId) === undefined) {
                map.addSource(sourceId, {
                  type: "canvas",
                  canvas: layer.canvas,
                  coordinates: layer.coordinates,
                  animate: false,
                });
              }
              if (map.getLayer(layer.id) !== undefined) return;
              const firstSymbol = style?.layers?.find(
                (candidate) => candidate.type === "symbol",
              )?.id;
              map.addLayer(
                {
                  id: layer.id,
                  type: "raster",
                  source: sourceId,
                  paint: { "raster-fade-duration": 0 },
                },
                firstSymbol,
              );
              publish();
            } finally {
              ensuring = false;
            }
          };
          map.on("styledata", ensureLayer);
          map.on("load", ensureLayer);
          map.on("click", onClick);
          dispose = () => {
            map.off("styledata", ensureLayer);
            map.off("load", ensureLayer);
            map.off("click", onClick);
            map.off("render", pause);
            layer.dispose();
          };
          ensureLayer();
        } catch (error) {
          dispose?.();
          map.fire("error", {
            error:
              error instanceof Error
                ? error
                : new Error("Fog initialization failed"),
          });
        }
      },
      () => {
        if (!removed)
          map.fire("error", { error: new Error("Fog runtime unavailable") });
      },
    );

    map.on("remove", () => {
      removed = true;
      dispose?.();
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
