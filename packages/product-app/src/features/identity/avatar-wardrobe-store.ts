// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from "react";

/**
 * What a body is wearing, kept on this device.
 *
 * The body a Bond chose is identity state the service keeps. What that body is
 * wearing is not: the identity contract publishes no field for it, so this
 * client remembers it locally rather than pretending a choice reached the
 * service. That boundary is the point — an outfit is presentation, and nothing
 * here is Bond, Relationship or shared-world state.
 *
 * It follows that an outfit does not travel between devices yet, and a person
 * should be able to tell that from the interface rather than discover it.
 */
export const AVATAR_WARDROBE_STORAGE_KEY = "nilx-one.avatar.wardrobe";

export interface StoredAvatarChoice {
  /**
   * A locally chosen study. The Bond's own body is the service's to keep, so
   * this is only ever written for a subject the contract has no field for.
   */
  readonly modelId?: string;
  /**
   * A serialized appearance per study, each interpreted only by the model it
   * belongs to. Kept per study rather than per subject so that leaving a body
   * and coming back to it finds the clothes it was left in — an appearance
   * means nothing to another study, so one slot for all of them would throw
   * away whatever the last study was not wearing.
   */
  readonly appearances?: Readonly<Record<string, string>>;
}

type Wardrobe = Readonly<Record<string, StoredAvatarChoice>>;

const EMPTY: StoredAvatarChoice = Object.freeze({});

let cache: Wardrobe | undefined;
const listeners = new Set<() => void>();

function read(): Wardrobe {
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(AVATAR_WARDROBE_STORAGE_KEY);
    const parsed: unknown = raw === null ? {} : JSON.parse(raw);
    cache =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Wardrobe)
        : {};
  } catch {
    // A host that refuses storage still gets a body: the study's own default.
    cache = {};
  }
  return cache;
}

// A snapshot React can compare. Reading is a projection of stored text, so it
// has to answer with the same object until the stored text actually changes —
// a fresh object every read would be a fresh render every render.
const snapshots = new Map<
  string,
  { readonly source: Wardrobe; readonly value: StoredAvatarChoice }
>();

/** What this device remembers for one address. Never throws, never guesses. */
export function readAvatarChoice(address: string): StoredAvatarChoice {
  const source = read();
  const remembered = snapshots.get(address);
  if (remembered !== undefined && remembered.source === source) {
    return remembered.value;
  }
  const stored = source[address];
  const usable =
    stored === undefined || typeof stored !== "object" ? undefined : stored;
  const modelId =
    typeof usable?.modelId === "string" ? usable.modelId : undefined;
  const wardrobe = usable?.appearances;
  const appearances: Record<string, string> = {};
  if (typeof wardrobe === "object" && wardrobe !== null) {
    for (const [model, text] of Object.entries(wardrobe)) {
      if (typeof text === "string") appearances[model] = text;
    }
  }
  const worn = Object.keys(appearances).length > 0;
  const value: StoredAvatarChoice =
    modelId === undefined && !worn
      ? EMPTY
      : Object.freeze({
          ...(modelId === undefined ? {} : { modelId }),
          ...(worn ? { appearances: Object.freeze(appearances) } : {}),
        });
  snapshots.set(address, { source, value });
  return value;
}

/**
 * Record a choice for one address. An address with nothing to say is removed
 * rather than left holding an empty record, so "never chosen" stays legible.
 */
export function writeAvatarChoice(
  address: string,
  choice: StoredAvatarChoice,
): void {
  const next: Record<string, StoredAvatarChoice> = { ...read() };
  const nothing =
    choice.appearances === undefined ||
    Object.keys(choice.appearances).length === 0;
  if (choice.modelId === undefined && nothing) {
    delete next[address];
  } else {
    next[address] = choice;
  }
  cache = next;
  try {
    window.localStorage.setItem(
      AVATAR_WARDROBE_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // Presentation state that cannot be written is still presentation state:
    // the change holds for this session rather than being refused.
  }
  for (const listener of listeners) listener();
}

/** Forget everything this device remembers. Used by tests and by sign-out. */
export function forgetAvatarChoices(): void {
  cache = {};
  try {
    window.localStorage.removeItem(AVATAR_WARDROBE_STORAGE_KEY);
  } catch {
    // Nothing to undo on a host that never stored it.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The stored choice for one address, kept in step across every surface. */
export function useAvatarChoice(address: string): StoredAvatarChoice {
  return useSyncExternalStore(
    subscribe,
    () => readAvatarChoice(address),
    () => EMPTY,
  );
}
