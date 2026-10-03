// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** A geographic point, longitude first, as tiles and GeoJSON carry it. */
export type LonLat = readonly [longitude: number, latitude: number];

const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where a point falls on a segment: `t` in [0, 1] from `a` to `b`. */
export interface SegmentProjection {
  readonly t: number;
  readonly point: LonLat;
  readonly distanceM: number;
}

/**
 * Nearest point on segment `a`–`b` to `p`. Projected on a local
 * equirectangular plane, which is exact enough at walking scale.
 */
export function projectOnSegment(
  p: LonLat,
  a: LonLat,
  b: LonLat,
): SegmentProjection {
  const k = Math.cos(a[1] * RAD);
  const bx = (b[0] - a[0]) * k;
  const by = b[1] - a[1];
  const px = (p[0] - a[0]) * k;
  const py = p[1] - a[1];
  const lengthSq = bx * bx + by * by;
  const raw = lengthSq === 0 ? 0 : (px * bx + py * by) / lengthSq;
  const t = Math.min(1, Math.max(0, raw));
  const point = lerp(a, b, t);
  return { t, point, distanceM: distanceM(p, point) };
}

export function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
