// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  MAP_BODY_TARGET_PIXELS,
  type MapScreenPoint,
} from "@nilx-one/map-contract";

/**
 * A body as it currently stands on the screen: where its feet are, and how
 * tall it was drawn there. Both are the renderer's own projection of a handle
 * it is already drawing, so a hit test never re-derives geography.
 */
export interface DrawnBody {
  readonly id: string;
  /** Where the body meets the ground, in viewport pixels. */
  readonly feet: MapScreenPoint;
  /** The height it occupies above that point. */
  readonly heightPixels: number;
}

/**
 * The body a person pointed at, if they pointed at one.
 *
 * A body is drawn about as tall as a fingertip is wide, so what answers a tap
 * is a target around it rather than the pixels it covers. Where two bodies
 * overlap — which is what a handover looks like for as long as it runs — the
 * one whose middle is nearest the point answers, so the reach never depends on
 * the order the renderer happens to hold them in.
 */
export function bodyAtPoint(
  bodies: readonly DrawnBody[],
  point: MapScreenPoint,
): string | undefined {
  let nearest: { id: string; distance: number } | undefined;

  for (const body of bodies) {
    const half = Math.max(MAP_BODY_TARGET_PIXELS, body.heightPixels) / 2;
    const middleY = body.feet.y - body.heightPixels / 2;
    const offsetX = point.x - body.feet.x;
    const offsetY = point.y - middleY;
    if (Math.abs(offsetX) > half || Math.abs(offsetY) > half) continue;

    const distance = Math.hypot(offsetX, offsetY);
    if (nearest === undefined || distance < nearest.distance) {
      nearest = { id: body.id, distance };
    }
  }

  return nearest?.id;
}
