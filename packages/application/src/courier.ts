// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface CourierCoordinate {
  readonly longitude_e7: string;
  readonly latitude_e7: string;
}

/**
 * A BusinessPoint's stable ID (0x1 `13-business-bonds-and-presence.md`): the
 * owning BBond's `pub_dress` at allocation and a `UInt8` number. Kept as two
 * components; their portable encoding is Core's to define.
 */
export interface BusinessPointId {
  readonly owner_pub_dress: string;
  readonly number: number;
}

/**
 * One BusinessPoint as the courier and the map see it. The point is itself
 * the destination: there is no separate destination record.
 */
export interface BusinessPoint {
  readonly id: BusinessPointId;
  /** The point's public address; seeded for a preview, not derived by Web. */
  readonly pub_dress: string;
  readonly description: string;
  /** Read-only projection of `verification.status == verified`. */
  readonly isVerified: boolean;
  readonly coordinate: CourierCoordinate;
}

/** The BusinessPoints of one owner eligible in the caller's context. */
export interface BusinessPointProjection {
  readonly owner_pub_dress: string;
  readonly points: readonly BusinessPoint[];
}

export interface CourierDirectoryPort {
  points(): Promise<BusinessPointProjection>;
  /**
   * Local presentation-only selection over this directory's own seeded
   * points, used only when the runtime has no `courier_destination`.
   */
  previewDestination?(
    origin: CourierCoordinate,
    projection: BusinessPointProjection,
  ): BusinessPoint;
}

export class CourierCapabilityUnavailable extends Error {
  constructor() {
    super("Core courier capability unavailable");
  }
}

/** Core `courier_destination` input (core `docs/courier-destination.md`). */
export interface CourierDestinationRequest {
  readonly origin: CourierCoordinate;
  readonly candidates: readonly {
    readonly point_id: string;
    readonly coordinate: CourierCoordinate;
  }[];
}

/**
 * Within one owner's projection a point is told apart by its number alone.
 * Zero-padded, so Core's smallest-id tie break is the smallest number.
 */
export const courierPointId = (id: BusinessPointId): string =>
  String(id.number).padStart(3, "0");

export function validBusinessPointId(id: BusinessPointId): boolean {
  return (
    id.owner_pub_dress.length > 0 &&
    Number.isInteger(id.number) &&
    id.number >= 0 &&
    id.number <= 255
  );
}

export function courierDestinationRequest(
  origin: CourierCoordinate,
  projection: BusinessPointProjection,
): CourierDestinationRequest {
  return {
    origin,
    candidates: projection.points.map((point) => {
      if (
        point.id.owner_pub_dress !== projection.owner_pub_dress ||
        !validBusinessPointId(point.id)
      )
        throw new Error("Invalid BusinessPoint projection");
      return {
        point_id: courierPointId(point.id),
        coordinate: point.coordinate,
      };
    }),
  };
}

/** Decodes Core's answer to the chosen point of the projection, or throws. */
export function decodeCourierDestination(
  wire: string,
  projection: BusinessPointProjection,
): BusinessPoint {
  const value = JSON.parse(wire) as { ok?: unknown; point_id?: unknown };
  const point =
    value?.ok === true && typeof value.point_id === "string"
      ? projection.points.find(
          (candidate) => courierPointId(candidate.id) === value.point_id,
        )
      : undefined;
  if (point === undefined)
    throw new Error("Invalid or unavailable courier destination");
  return point;
}

/** A dispatched trip as Web records it locally. No ETA: the flyover owns it. */
export interface CourierPlan {
  readonly origin: CourierCoordinate;
  readonly destination: BusinessPoint;
  readonly started_at_ms: string;
}
