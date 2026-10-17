// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface CourierCoordinate {
  readonly longitude_e7: string;
  readonly latitude_e7: string;
}
export interface CourierDestination {
  readonly business_id: string;
  readonly point_id: string;
  readonly coordinate: CourierCoordinate;
}
/** Authenticated, verified subscription-capable projection, not station Avaia. */
export interface CourierDirectoryPort {
  /** Local presentation-only preview, available only on explicitly seeded maps. */
  previewPlan?(request: CourierRequest): CourierPlan;
  destinations(): Promise<{
    readonly business_id: string;
    readonly destinations: readonly CourierDestination[];
  }>;
}
export class CourierCapabilityUnavailable extends Error {
  constructor() {
    super("Core courier capability unavailable");
  }
}
export interface CourierRequest {
  readonly tier: "exclusive" | "special";
  readonly business_id: string;
  readonly origin: CourierCoordinate;
  readonly destinations: readonly CourierDestination[];
  readonly started_at_ms: string;
}
export interface CourierPlan {
  readonly tier: "exclusive" | "special";
  readonly destination: CourierDestination;
  readonly origin: CourierCoordinate;
  readonly started_at_ms: string;
  readonly arrives_at_ms: string;
  readonly distance_m: string;
}
export function decodeCourierPlan(wire: string): CourierPlan {
  const value = JSON.parse(wire) as CourierPlan;
  const unsigned = (n: unknown) =>
    typeof n === "string" &&
    /^(0|[1-9]\d*)$/.test(n) &&
    Number.isSafeInteger(Number(n));
  const coordinate = (p: CourierCoordinate | undefined) =>
    p !== undefined &&
    [p.longitude_e7, p.latitude_e7].every(
      (n) => typeof n === "string" && /^(0|-?[1-9]\d*)$/.test(n),
    ) &&
    Math.abs(Number(p.longitude_e7)) <= 1800000000 &&
    Math.abs(Number(p.latitude_e7)) <= 900000000;
  if (
    !value ||
    (value.tier !== "exclusive" && value.tier !== "special") ||
    !coordinate(value.origin) ||
    !coordinate(value.destination?.coordinate) ||
    !value.destination.business_id ||
    !value.destination.point_id ||
    !unsigned(value.started_at_ms) ||
    !unsigned(value.arrives_at_ms) ||
    !unsigned(value.distance_m) ||
    Number(value.arrives_at_ms) < Number(value.started_at_ms)
  )
    throw new Error("Invalid or unavailable courier plan");
  return value;
}
