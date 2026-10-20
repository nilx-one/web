// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  MapBounds,
  MapPointSelection,
  MapRenderer,
} from "@nilx-one/map-contract";
import { useCallback, useRef } from "react";

import { walkGround, type WalkGround } from "./walk-ground";

/** How far around a body the ground under it is read at once. */
export const LIFT_AREA_METERS = 150;

/** A body this close to the edge of what was read has it read again. */
const LIFT_AREA_MARGIN_METERS = 50;

/**
 * How long the ground read under a body is trusted: tiles keep loading as
 * the camera moves, and a terrace that arrives later is still stood on.
 */
const LIFT_AREA_TTL_MS = 3_000;

/**
 * How fast a body's height may change, in metres a second. Steps change it
 * gently on their own; this only softens the rare drop the data leaves
 * sharp — a path drawn onto a terrace with no steps, or a terrace whose
 * tile has just arrived under a standing body.
 */
export const LIFT_SPEED_MPS = 3;

const EARTH_RADIUS_METERS = 6_371_008.8;

interface Area {
  readonly bounds: MapBounds;
  readonly inner: MapBounds;
  readonly ground: WalkGround;
  readonly readMs: number;
}

/**
 * How high above the drawn ground each body stands, frame by frame: on the
 * terraces and steps the map draws (`walkGround`), eased so a body never
 * jumps a storey in one frame. Presentation only, like the bodies it lifts.
 */
export function useWalkGroundLift(
  renderer: Pick<MapRenderer, "obstaclesWithin" | "roadsWithin">,
): (body: string, point: MapPointSelection, nowMs: number) => number {
  const area = useRef<Area | undefined>(undefined);
  const eased = useRef(
    new Map<string, { readonly lift: number; readonly atMs: number }>(),
  );

  return useCallback(
    (body, point, nowMs) => {
      let current = area.current;
      if (
        current === undefined ||
        nowMs - current.readMs > LIFT_AREA_TTL_MS ||
        !inside(point, current.inner)
      ) {
        const bounds = around(point, LIFT_AREA_METERS);
        current = {
          bounds,
          inner: around(point, LIFT_AREA_METERS - LIFT_AREA_MARGIN_METERS),
          ground: walkGround(
            renderer.obstaclesWithin?.(bounds) ?? [],
            renderer.roadsWithin?.(bounds) ?? [],
          ),
          readMs: nowMs,
        };
        area.current = current;
      }
      const target = current.ground.liftAt(point);
      const last = eased.current.get(body);
      const lift =
        last === undefined
          ? target
          : approach(
              last.lift,
              target,
              (Math.max(0, nowMs - last.atMs) / 1000) * LIFT_SPEED_MPS,
            );
      eased.current.set(body, { lift, atMs: nowMs });
      return lift;
    },
    [renderer],
  );
}

function approach(from: number, to: number, by: number): number {
  return from < to ? Math.min(to, from + by) : Math.max(to, from - by);
}

function around(point: MapPointSelection, meters: number): MapBounds {
  const dLat = (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const dLng =
    dLat / Math.max(0.01, Math.cos((point.latitude * Math.PI) / 180));
  return {
    west: point.longitude - dLng,
    east: point.longitude + dLng,
    south: point.latitude - dLat,
    north: point.latitude + dLat,
  };
}

function inside(point: MapPointSelection, box: MapBounds): boolean {
  return (
    point.longitude >= box.west &&
    point.longitude <= box.east &&
    point.latitude >= box.south &&
    point.latitude <= box.north
  );
}
