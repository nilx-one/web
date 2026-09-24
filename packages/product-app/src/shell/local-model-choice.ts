// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Which local model the owner chose, stored on this device.
 *
 * Chosen and downloaded are different facts: this stores the first and fetches nothing. It
 * never enters identity or Core state — a choice is about this device's memory and this
 * person's reading, not about who they are. Whatever composes narration reads the same
 * choice through `readLocalModelChoice`, so the model Settings shows is the model that loads.
 */

import { useSyncExternalStore } from "react";

export const LOCAL_MODEL_CHOICE_STORAGE_KEY = "nilx-one.localModel.choice";

const listeners = new Set<() => void>();
/** Held only for a device that refuses storage, so a choice still lasts the session. */
let unstoredChoice: string | undefined;

export function readLocalModelChoice(): string | undefined {
  try {
    const stored = window.localStorage.getItem(LOCAL_MODEL_CHOICE_STORAGE_KEY);
    return stored === null || stored === "" ? unstoredChoice : stored;
  } catch {
    return unstoredChoice;
  }
}

export function chooseLocalModel(modelId: string): void {
  try {
    window.localStorage.setItem(LOCAL_MODEL_CHOICE_STORAGE_KEY, modelId);
  } catch {
    unstoredChoice = modelId;
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLocalModelChoice(): string | undefined {
  return useSyncExternalStore(subscribe, readLocalModelChoice, () => undefined);
}
