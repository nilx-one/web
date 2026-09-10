// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  setBondLocationOverride,
  type BondLocationOverrides,
} from "@nilx-one/application";

const STORAGE_VERSION = 1 as const;
const STORAGE_PREFIX = "nilx-one.bond-location-overrides.v1";

interface StoredOverride {
  readonly counterpartPubDress: string;
  readonly longitude: number;
  readonly latitude: number;
}

interface StoredOverridesV1 {
  readonly version: typeof STORAGE_VERSION;
  readonly entries: readonly StoredOverride[];
}

export type BondLocationOverridesReadResult =
  | { readonly kind: "ready"; readonly overrides: BondLocationOverrides }
  | { readonly kind: "unavailable"; readonly overrides: BondLocationOverrides }
  | { readonly kind: "corrupt" };

export type BondLocationOverridesWriteResult = "saved" | "unavailable";

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

function storageKey(ownerPubDress: string): string {
  return `${STORAGE_PREFIX}:${ownerPubDress}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Reads only artificial presentation positions for one authenticated owner.
 * Device-observed coordinates are deliberately absent from this store.
 * Corruption is explicit so a future disclosure path can fail closed instead
 * of interpreting a broken policy as "no override" and leaking real position.
 */
export function readBondLocationOverrides(
  storage: ReadStorage,
  ownerPubDress: string,
): BondLocationOverridesReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(ownerPubDress));
  } catch {
    return { kind: "unavailable", overrides: new Map() };
  }

  if (raw === null) return { kind: "ready", overrides: new Map() };

  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return { kind: "corrupt" };
  }

  if (
    !isRecord(value) ||
    value.version !== STORAGE_VERSION ||
    !Array.isArray(value.entries)
  ) {
    return { kind: "corrupt" };
  }

  let overrides: BondLocationOverrides = new Map();
  const seen = new Set<string>();
  for (const candidate of value.entries) {
    if (
      !isRecord(candidate) ||
      typeof candidate.counterpartPubDress !== "string" ||
      typeof candidate.longitude !== "number" ||
      typeof candidate.latitude !== "number" ||
      seen.has(candidate.counterpartPubDress)
    ) {
      return { kind: "corrupt" };
    }

    try {
      overrides = setBondLocationOverride(
        overrides,
        candidate.counterpartPubDress,
        {
          longitude: candidate.longitude,
          latitude: candidate.latitude,
        },
      );
    } catch {
      return { kind: "corrupt" };
    }
    seen.add(candidate.counterpartPubDress);
  }

  return { kind: "ready", overrides };
}

/**
 * Persists the complete immutable policy for one owner. The deterministic sort
 * makes the stored document stable while keeping the application Map-shaped.
 */
export function writeBondLocationOverrides(
  storage: WriteStorage,
  ownerPubDress: string,
  overrides: BondLocationOverrides,
): BondLocationOverridesWriteResult {
  const document: StoredOverridesV1 = {
    version: STORAGE_VERSION,
    entries: [...overrides.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([counterpartPubDress, position]) => ({
        counterpartPubDress,
        longitude: position.longitude,
        latitude: position.latitude,
      })),
  };

  try {
    storage.setItem(storageKey(ownerPubDress), JSON.stringify(document));
    return "saved";
  } catch {
    return "unavailable";
  }
}
