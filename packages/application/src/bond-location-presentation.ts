// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { WorldPosition } from "./avaia-movement-controller";
import { parsePubDress } from "./identity-registration";

/**
 * A per-counterpart location override is disclosure policy, not an observation.
 *
 * The key is the exact canonical `Bond.pub_dress` that may receive this
 * presentation. Nothing here changes the device observation, local presence
 * journal, BondChain, or Relationship state.
 */
export type BondLocationOverrides = ReadonlyMap<string, WorldPosition>;

export type BondLocationPresentationSource = "observed" | "override";

/**
 * A location resolved for exactly one counterpart.
 *
 * Keeping the counterpart on the result makes accidental reuse for another
 * Bond visible at the transport boundary. `source` is local provenance only;
 * it is not a claim that belongs in shared protocol state.
 */
export interface BondLocationPresentation {
  readonly counterpartPubDress: string;
  readonly position: WorldPosition;
  readonly source: BondLocationPresentationSource;
}

function isCanonicalBondPubDress(value: string): boolean {
  return parsePubDress(value) !== undefined;
}

function isValidWorldPosition(
  position: WorldPosition | undefined,
): position is WorldPosition {
  return (
    position !== undefined &&
    Number.isFinite(position.longitude) &&
    Number.isFinite(position.latitude) &&
    position.longitude >= -180 &&
    position.longitude <= 180 &&
    position.latitude >= -90 &&
    position.latitude <= 90
  );
}

function copyPosition(position: WorldPosition): WorldPosition {
  return {
    longitude: position.longitude,
    latitude: position.latitude,
  };
}

function assertCounterpartPubDress(pubDress: string): void {
  if (!isCanonicalBondPubDress(pubDress)) {
    throw new RangeError("invalid-counterpart-pub-dress");
  }
}

function assertWorldPosition(position: WorldPosition): void {
  if (!isValidWorldPosition(position)) {
    throw new RangeError("invalid-location-override");
  }
}

/**
 * Returns a new policy map with one exact counterpart overridden.
 *
 * Both the map and position are copied so changing caller-owned values later
 * cannot silently retarget or move an already-configured disclosure rule.
 */
export function setBondLocationOverride(
  overrides: BondLocationOverrides,
  counterpartPubDress: string,
  position: WorldPosition,
): BondLocationOverrides {
  assertCounterpartPubDress(counterpartPubDress);
  assertWorldPosition(position);

  const next = new Map(overrides);
  next.set(counterpartPubDress, copyPosition(position));
  return next;
}

/** Returns a new policy map without the exact counterpart override. */
export function removeBondLocationOverride(
  overrides: BondLocationOverrides,
  counterpartPubDress: string,
): BondLocationOverrides {
  assertCounterpartPubDress(counterpartPubDress);

  const next = new Map(overrides);
  next.delete(counterpartPubDress);
  return next;
}

/**
 * Resolves the position that may be presented to one counterpart.
 *
 * A configured override wins even when the device has no observation. If an
 * override entry exists but is invalid at runtime, resolution fails closed:
 * falling back to the observed position would disclose the one value the rule
 * exists to replace. Invalid counterpart addresses also fail closed.
 */
export function resolveBondLocationPresentation(
  counterpartPubDress: string,
  observedPosition: WorldPosition | undefined,
  overrides: BondLocationOverrides,
): BondLocationPresentation | undefined {
  if (!isCanonicalBondPubDress(counterpartPubDress)) return undefined;

  if (overrides.has(counterpartPubDress)) {
    const override = overrides.get(counterpartPubDress);
    if (!isValidWorldPosition(override)) return undefined;

    return {
      counterpartPubDress,
      position: copyPosition(override),
      source: "override",
    };
  }

  if (!isValidWorldPosition(observedPosition)) return undefined;

  return {
    counterpartPubDress,
    position: copyPosition(observedPosition),
    source: "observed",
  };
}
