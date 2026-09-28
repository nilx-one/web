// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Full local wipe. Bump WIPE_EPOCH to make every browser forget the game it
 * remembers — fog, progression, journal, notebook, wardrobe — exactly once.
 * Interface preferences (locale, appearance, dimension, local model) survive:
 * they describe the person's screen, not the world.
 */
export const WIPE_EPOCH = "2026-09-28";

const EPOCH_KEY = "nilx-one.wipe-epoch";
const GAME_PREFIX = "nilx-one.";
const KEEP_PREFIXES = ["nilx-one.interface.", "nilx-one.localModel."];
const DATABASES = ["nilx-presence"];

/**
 * Synchronous on purpose: it must finish before any module reads the world.
 * Database deletes are queued ahead of any later open of the same name.
 */
export function wipeLocalWorldOnce(
  storage: Storage | undefined = globalThis.localStorage,
): boolean {
  try {
    if (storage === undefined || storage.getItem(EPOCH_KEY) === WIPE_EPOCH) {
      return false;
    }
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (
        key !== null &&
        key.startsWith(GAME_PREFIX) &&
        !KEEP_PREFIXES.some((keep) => key.startsWith(keep))
      ) {
        doomed.push(key);
      }
    }
    doomed.forEach((key) => storage.removeItem(key));
    if (typeof globalThis.indexedDB !== "undefined") {
      DATABASES.forEach((name) => globalThis.indexedDB.deleteDatabase(name));
    }
    storage.setItem(EPOCH_KEY, WIPE_EPOCH);
    return true;
  } catch {
    return false;
  }
}
