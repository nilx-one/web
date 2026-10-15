// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * A stationed Avaia: one per shop of a business Bond, standing at its shop.
 *
 * Where it stands is what the business published for every Bond to find. It
 * is not presence, attendance or BondChain evidence, and a station never
 * walks: the point is the whole of its position.
 */
export interface BusinessStationView {
  /** The station's own Avaia address. */
  readonly pubDress: string;
  /** The `pub_dress` of the business that keeps it. */
  readonly ownerPubDress: string;
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * Reads every station. `undefined` means the service did not answer usefully,
 * which is a normal state: stations are an extra on the world, never a fault.
 */
export interface BusinessStationAccessPort {
  readBusinessStations(): Promise<readonly BusinessStationView[] | undefined>;
}

export function hasBusinessStationAccess(
  value: unknown,
): value is BusinessStationAccessPort {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof (value as Partial<BusinessStationAccessPort>)
      .readBusinessStations === "function"
  );
}
