// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Map as MapLibreMap } from "maplibre-gl";
import { mapDistanceMeters, mapMetersPerPixel } from "@nilx-one/map-contract";

/** Wait for actual painted, settled frames, never MapLibre idle (animated layers repaint). */
export function waitForScene(
  map: MapLibreMap,
  assetsSettled: () => boolean,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stableFrames = 0;
    let previousView:
      { longitude: number; latitude: number; framing: string } | undefined;
    const finish = (error?: Error) => {
      map.off("render", render);
      map.off("remove", removed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const aborted = () =>
      finish(new DOMException("Scene wait aborted", "AbortError"));
    const removed = () =>
      finish(new Error("Map removed before scene was ready"));
    const render = () => {
      const center = map.getCenter();
      const framing = [
        map.getZoom(),
        map.getBearing(),
        map.getPitch(),
        ...Object.values(map.getPadding()),
      ].join();
      const view = { longitude: center.lng, latitude: center.lat, framing };
      if (
        !map.isStyleLoaded() ||
        !map.areTilesLoaded() ||
        map.isMoving() ||
        !assetsSettled()
      ) {
        stableFrames = 0;
      } else {
        // A walking driver's subpixel tracking is usable movement, not an
        // unfinished opening shot. Requiring identical coordinates would
        // keep an autonomous Avaia behind the cover indefinitely.
        const stable =
          previousView !== undefined &&
          previousView.framing === framing &&
          mapDistanceMeters(previousView, view) <=
            mapMetersPerPixel(center.lat, map.getZoom());
        stableFrames = stable ? stableFrames + 1 : 1;
      }
      previousView = view;
      // One additional paint includes custom-layer uploads/terrain placement
      // from the frame in which the last resource became available.
      if (stableFrames >= 2) finish();
      else map.triggerRepaint();
    };
    if (signal.aborted) {
      aborted();
      return;
    }
    signal.addEventListener("abort", aborted, { once: true });
    map.on("render", render);
    map.on("remove", removed);
    map.triggerRepaint();
  });
}
