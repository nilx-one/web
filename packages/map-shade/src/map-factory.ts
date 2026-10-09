// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, ShadeSource } from "@nilx-one/presence-contract";
import {
  Map as MapLibreMap,
  type MapOptions,
  type StyleSpecification,
  type CanvasSource,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";

import { fogFloorCss } from "./fog-material";

import {
  FOG_PALETTES,
  requireFogPalette,
  requireFogZones,
  styleAppearance,
  type FogPalette,
  type FogZone,
} from "./fog-palette";
import { atlasBounds, beyondAtlas, worldFog } from "./fog-world";
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

/** Web Mercator's equator, which a 512-pixel tile spans at zoom 0. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

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
          const worldId = "nilx-one-presence-shade-world";
          let publishing = false;
          const pause = () => {
            (map.getSource(sourceId) as CanvasSource | undefined)?.pause();
            publishing = false;
          };
          const publish = () => {
            if (removed) return;
            const source = map.getSource(sourceId) as CanvasSource | undefined;
            if (source === undefined) return;
            // Terrain drapes the fog through cached per-tile textures keyed by
            // tile coverage, not by canvas content: a canvas upload alone never
            // reaches them, and the ground keeps whatever fog (often none) was
            // there on first draw. Drop that cache with every new fog frame.
            map.terrain?.tileManager.releaseAllRTT();
            // Keep the canvas active through one render so the new frame is
            // uploaded. Static fog never drives an endless map repaint.
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
          // The atlas draws mist over a fixed square; the rest of the Earth
          // wears flat mist of the same floor colour, holed only where ground
          // was revealed wholly beyond the square. It changes only when such
          // ground does, never with the drift.
          const bounds = atlasBounds(layer.coordinates);
          let worldKey: string | undefined;
          const worldData = () => {
            const beyond = runtime.source
              .litCells()
              .filter((cell) => beyondAtlas(cell, bounds))
              .sort();
            const key = beyond.join();
            if (key === worldKey) return undefined;
            worldKey = key;
            return worldFog(bounds, beyond);
          };
          let worldTimer: ReturnType<typeof setTimeout> | undefined;
          const refreshWorld = () => {
            if (worldTimer !== undefined) return;
            worldTimer = setTimeout(() => {
              worldTimer = undefined;
              if (removed) return;
              const world = map.getSource(worldId) as GeoJSONSource | undefined;
              const data = world === undefined ? undefined : worldData();
              if (data !== undefined) world?.setData(data);
            }, 0);
          };
          const touchesWorld = (cell: string) => {
            if (beyondAtlas(cell, bounds)) refreshWorld();
          };
          const unsubscribeWorld = [
            runtime.source.onCellLit(touchesWorld),
            runtime.source.onCellUnlit?.(touchesWorld),
            runtime.source.onReset?.(() => {
              worldKey = undefined;
              refreshWorld();
            }),
          ];
          let worldPalette: FogPalette | undefined;
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
              const palette = palettes[styleAppearance(style)];
              if (style !== undefined) layer.setPalette(palette);
              if (!map.isStyleLoaded()) return;
              if (map.getSource(worldId) === undefined) {
                worldKey = undefined;
                map.addSource(worldId, {
                  type: "geojson",
                  data: worldData() ?? worldFog(bounds, []),
                });
              }
              if (map.getSource(sourceId) === undefined) {
                map.addSource(sourceId, {
                  type: "canvas",
                  canvas: layer.canvas,
                  coordinates: layer.coordinates,
                  animate: false,
                });
              }
              const firstSymbol = style?.layers?.find(
                (candidate) => candidate.type === "symbol",
              )?.id;
              if (map.getLayer(worldId) === undefined) {
                worldPalette = palette;
                map.addLayer(
                  {
                    id: worldId,
                    type: "fill",
                    source: worldId,
                    paint: {
                      "fill-color": fogFloorCss(palette),
                      // Opaque, as the atlas is along its edge: the two overlap
                      // there without a seam. Unexplored ground stays hidden.
                      "fill-opacity": 1,
                      // An antialiased edge would draw the seam back as a line.
                      "fill-antialias": false,
                    },
                  },
                  firstSymbol,
                );
              } else if (worldPalette !== palette) {
                worldPalette = palette;
                map.setPaintProperty(
                  worldId,
                  "fill-color",
                  fogFloorCss(palette),
                );
              }
              if (map.getLayer(layer.id) !== undefined) return;
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
          // The clouds keep only what reads as mist at this scale. Measured
          // once a zoom settles, never mid-gesture, and quantized in the
          // layer: only a whole zoom level's change redraws the fog.
          const measureDetail = () => {
            if (removed) return;
            const latitude = (map.getCenter().lat * Math.PI) / 180;
            layer.setDetail(
              (EARTH_CIRCUMFERENCE_M * Math.cos(latitude)) /
                (512 * 2 ** map.getZoom()),
            );
          };
          measureDetail();
          map.on("zoomend", measureDetail);
          map.on("styledata", ensureLayer);
          map.on("load", ensureLayer);
          map.on("click", onClick);
          dispose = () => {
            map.off("zoomend", measureDetail);
            map.off("styledata", ensureLayer);
            map.off("load", ensureLayer);
            map.off("click", onClick);
            map.off("render", pause);
            clearTimeout(worldTimer);
            for (const unsubscribe of unsubscribeWorld) unsubscribe?.();
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
