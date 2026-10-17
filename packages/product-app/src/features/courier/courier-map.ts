// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { CourierCoordinate } from "@nilx-one/application";
import type { MapCamera, MapPointSelection } from "@nilx-one/map-contract";
export const courierPoint = (p: CourierCoordinate): MapPointSelection => ({
  longitude: Number(p.longitude_e7) / 1e7,
  latitude: Number(p.latitude_e7) / 1e7,
});
export const courierCoordinate = (p: MapPointSelection): CourierCoordinate => ({
  longitude_e7: String(Math.round(p.longitude * 1e7)),
  latitude_e7: String(Math.round(p.latitude * 1e7)),
});
/** Fit all points in a conservative unobscured viewport; wrap across the dateline. */
export function activityCamera(
  points: readonly MapPointSelection[],
  width: number,
  height: number,
): MapCamera | undefined {
  if (!points.length) return undefined;
  const origin = points[0]!.longitude;
  const xs = points.map(
    (p) => origin + ((p.longitude - origin + 540) % 360) - 180,
  );
  const merc = (lat: number) =>
    Math.log(
      Math.tan(
        Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360,
      ),
    );
  const ys = points.map((p) => merc(p.latitude));
  const left = Math.min(...xs),
    right = Math.max(...xs),
    bottom = Math.min(...ys),
    top = Math.max(...ys);
  const zx = Math.log2(
    (Math.max(100, width * 0.65) * 360) /
      (512 * Math.max(0.00001, right - left)),
  );
  const zy = Math.log2(
    (Math.max(100, height * 0.4) * 2 * Math.PI) /
      (512 * Math.max(0.000001, top - bottom)),
  );
  return {
    center: [
      (((left + right) / 2 + 540) % 360) - 180,
      ((2 * Math.atan(Math.exp((bottom + top) / 2)) - Math.PI / 2) * 180) /
        Math.PI,
    ],
    zoom: Math.max(0, Math.min(18, zx, zy)),
    bearing: 0,
    pitch: 0,
  };
}
