// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Full local wipe. Bump WIPE_EPOCH to make every browser forget the game it
 * remembers — fog, progression, journal, notebook, wardrobe — exactly once.
 * Interface preferences (locale, appearance, dimension, local model) survive:
 * they describe the person's screen, not the world.
 *
 * The epoch is recorded only after every step is confirmed, so a wipe that
 * could not finish is tried again on the next load instead of being counted
 * as done. The composition root awaits the outcome before the world is read.
 */
export const WIPE_EPOCH = "2026-09-28";

const EPOCH_KEY = "nilx-one.wipe-epoch";
const GAME_PREFIX = "nilx-one.";
const KEEP_PREFIXES = ["nilx-one.interface.", "nilx-one.localModel."];
const DATABASES = ["nilx-presence", "avaia-finds"];

/** A delete blocked by a connection some other tab holds open is not waited on forever. */
const DELETE_TIMEOUT_MS = 3000;

export type WipeOutcome =
  | { readonly status: "skipped" }
  | { readonly status: "wiped" }
  | { readonly status: "incomplete"; readonly failures: readonly string[] };

function deleteDatabase(
  factory: IDBFactory,
  name: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve(`${name}: delete blocked`),
      DELETE_TIMEOUT_MS,
    );
    const settle = (failure?: string) => {
      clearTimeout(timer);
      resolve(failure);
    };
    try {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => settle();
      request.onerror = () =>
        settle(`${name}: ${request.error?.message ?? "delete failed"}`);
    } catch (error) {
      settle(`${name}: ${error instanceof Error ? error.message : "failed"}`);
    }
  });
}

export async function wipeLocalWorldOnce(
  storage: Storage | undefined = globalThis.localStorage,
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<WipeOutcome> {
  const failures: string[] = [];

  try {
    if (storage === undefined || storage.getItem(EPOCH_KEY) === WIPE_EPOCH) {
      return { status: "skipped" };
    }
  } catch (error) {
    return {
      status: "incomplete",
      failures: [
        `storage: ${error instanceof Error ? error.message : "failed"}`,
      ],
    };
  }

  try {
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
  } catch (error) {
    failures.push(
      `storage: ${error instanceof Error ? error.message : "failed"}`,
    );
  }

  if (factory !== undefined) {
    const results = await Promise.all(
      DATABASES.map((name) => deleteDatabase(factory, name)),
    );
    failures.push(...results.filter((r): r is string => r !== undefined));
  }

  if (failures.length > 0) {
    return { status: "incomplete", failures };
  }

  try {
    storage.setItem(EPOCH_KEY, WIPE_EPOCH);
  } catch (error) {
    return {
      status: "incomplete",
      failures: [`epoch: ${error instanceof Error ? error.message : "failed"}`],
    };
  }
  return { status: "wiped" };
}
