// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundAmbience, SoundCapability } from "@nilx-one/host-contract";
import type {
  MapBounds,
  MapCamera,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useEffect } from "react";

import { insidePolygon } from "./avaia-route";

/**
 * What the world in view sounds like, read off what the map already paints.
 *
 * The listener is the camera, the way it is in a game: the ground under the
 * middle of the view is what is heard, and zooming in brings it closer. It
 * reads only tiles already loaded and the fog this device already drew, so
 * it asks for nothing on its own behalf, and it is presentation and nothing
 * else — it says nothing about where any Bond is.
 */

/** How far around the middle of the view the ground is listened to. */
export const AMBIENCE_RADIUS_METERS = 120;

/** Samples along each side of that square. */
const AMBIENCE_GRID = 7;

/** Below this zoom the view is a city, not a place: the bed is silent. */
export const AMBIENCE_FAR_ZOOM = 12;
/** From this zoom on the view is close enough to be heard in full. */
export const AMBIENCE_NEAR_ZOOM = 16;

/**
 * How long the view must hold still before it is listened to again. A pan
 * is many camera changes, and the bed follows smoothly anyway.
 */
export const AMBIENCE_SETTLE_MS = 400;

/** Water this much of the ground already sounds like a shore. */
const WATER_FULL_SHARE = 0.4;
/** Buildings this much of the ground already sound like a dense street. */
const CITY_FULL_SHARE = 0.4;

const EARTH_RADIUS_METERS = 6_371_008.8;

const SILENT: SoundAmbience = Object.freeze({
  presence: 0,
  water: 0,
  city: 0,
  clarity: 1,
});

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function squareAround(center: MapPointSelection, meters: number): MapBounds {
  const dLat = (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng =
    dLat / Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  return {
    west: center.longitude - dLng,
    east: center.longitude + dLng,
    south: center.latitude - dLat,
    north: center.latitude + dLat,
  };
}

function samples(bounds: MapBounds): readonly MapPointSelection[] {
  const points: MapPointSelection[] = [];
  for (let row = 0; row < AMBIENCE_GRID; row += 1) {
    for (let column = 0; column < AMBIENCE_GRID; column += 1) {
      points.push({
        longitude:
          bounds.west +
          ((bounds.east - bounds.west) * (column + 0.5)) / AMBIENCE_GRID,
        latitude:
          bounds.south +
          ((bounds.north - bounds.south) * (row + 0.5)) / AMBIENCE_GRID,
      });
    }
  }
  return points;
}

export function worldAmbience(
  renderer: Pick<MapRenderer, "obstaclesWithin" | "fog">,
  camera: Pick<MapCamera, "center" | "zoom">,
): SoundAmbience {
  const presence = unit(
    (camera.zoom - AMBIENCE_FAR_ZOOM) /
      (AMBIENCE_NEAR_ZOOM - AMBIENCE_FAR_ZOOM),
  );
  if (presence === 0) return SILENT;

  const [longitude, latitude] = camera.center;
  const bounds = squareAround({ longitude, latitude }, AMBIENCE_RADIUS_METERS);
  const points = samples(bounds);
  const obstacles = renderer.obstaclesWithin?.(bounds) ?? [];

  let water = 0;
  let built = 0;
  let revealed = 0;
  const fog = renderer.fog?.isActive() === true ? renderer.fog : undefined;
  for (const point of points) {
    const at = [point.longitude, point.latitude] as const;
    let inWater = false;
    let inBuilding = false;
    for (const obstacle of obstacles) {
      if (obstacle.kind === "water" ? inWater : inBuilding) continue;
      if (obstacle.polygons.some((rings) => insidePolygon(at, rings))) {
        if (obstacle.kind === "water") inWater = true;
        else inBuilding = true;
      }
    }
    if (inWater) water += 1;
    if (inBuilding) built += 1;
    if (fog === undefined || fog.isRevealed(fog.cellAt(point).id)) {
      revealed += 1;
    }
  }

  return {
    presence,
    water: unit(water / points.length / WATER_FULL_SHARE),
    city: unit(built / points.length / CITY_FULL_SHARE),
    clarity: revealed / points.length,
  };
}

export interface WorldAmbienceInput {
  readonly renderer: MapRenderer;
  readonly sound: SoundCapability | undefined;
  /** The person asked for the world's sound, and there is a world to hear. */
  readonly enabled: boolean;
}

/**
 * Keeps the host's bed in step with the view: listened to again once the
 * camera settles, once more tiles land, and whenever fog lifts. Turned off,
 * or gone, it fades the bed out.
 */
export function useWorldAmbience({
  renderer,
  sound,
  enabled,
}: WorldAmbienceInput): void {
  useEffect(() => {
    if (sound === undefined || !enabled) return;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const listen = (): void => {
      try {
        sound.setAmbience(worldAmbience(renderer, renderer.getCamera()));
      } catch {
        // A bed that cannot be read leaves the cues as they were.
      }
    };
    const schedule = (): void => {
      if (settle !== undefined) globalThis.clearTimeout(settle);
      settle = globalThis.setTimeout(listen, AMBIENCE_SETTLE_MS);
    };
    listen();
    const unsubscribers = [
      renderer.subscribeCamera(schedule),
      renderer.subscribeLandmarksChanged?.call(renderer, schedule),
      renderer.fog?.subscribe(schedule),
    ];
    return () => {
      if (settle !== undefined) globalThis.clearTimeout(settle);
      for (const unsubscribe of unsubscribers) unsubscribe?.();
      try {
        sound.setAmbience(null);
      } catch {
        // Nothing to fade.
      }
    };
  }, [enabled, renderer, sound]);
}
