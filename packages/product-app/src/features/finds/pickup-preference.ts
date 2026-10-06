// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from "react";

/**
 * Which rarities get picked up on the way, as Core's wire form: the codes
 * commonest first, joined by `,`. Core owns what each code covers (tiers 1–3
 * are `common`, 4 `uncommon`, 5 `rare`, 6 `legendary`) and validates the
 * string; this module only stores it.
 *
 * It is kept on this device, like the sound: a choice about what this device
 * carries home. A find left behind is still seen and still pays its sighting.
 */
export const RARITIES = ["common", "uncommon", "rare", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const PICKUP_STORAGE_KEY = "nilx-one.finds.pickup";
export const DEFAULT_PICKUP = RARITIES.join(",");

const listeners = new Set<() => void>();
/** Held only for a device that refuses storage, so a choice lasts the session. */
let unstored: string | undefined;

/** Only a string made of known codes is read back; Core still validates it. */
function isPickupWire(value: string | null): value is string {
  if (value === null) return false;
  if (value === "") return true;
  return value
    .split(",")
    .every((code) => (RARITIES as readonly string[]).includes(code));
}

export function readPickup(): string {
  try {
    const stored = window.localStorage.getItem(PICKUP_STORAGE_KEY);
    if (isPickupWire(stored)) return stored;
  } catch {
    // Storage is optional; the session keeps whatever was chosen in it.
  }
  return unstored ?? DEFAULT_PICKUP;
}

export function pickedUpRarities(wire: string): ReadonlySet<Rarity> {
  return new Set(RARITIES.filter((rarity) => wire.split(",").includes(rarity)));
}

/** Includes or leaves out one rarity, keeping Core's commonest-first order. */
export function choosePickup(rarity: Rarity, pickedUp: boolean): void {
  const current = pickedUpRarities(readPickup());
  const next = RARITIES.filter((code) =>
    code === rarity ? pickedUp : current.has(code),
  ).join(",");
  try {
    window.localStorage.setItem(PICKUP_STORAGE_KEY, next);
  } catch {
    unstored = next;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePickup(): string {
  return useSyncExternalStore(subscribe, readPickup, () => DEFAULT_PICKUP);
}
