// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { SoundCapability, SoundCue } from "@nilx-one/host-contract";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * How much this device sounds. `cues` plays a short sound for what just
 * happened; `all` adds the bed of the world in view under them.
 *
 * It is stored on this device and nowhere else: another device has its own
 * speakers and stands somewhere else, so a choice made on a phone in a quiet
 * room means nothing to a laptop at a desk. It never enters identity or Core
 * state.
 */
export type SoundPreference = "off" | "cues" | "all";

export const SOUND_STORAGE_KEY = "nilx-one.interface.sound";

/**
 * Cues are on until a person says otherwise. Nothing plays before their
 * first press anyway — a browser opens audio only from a gesture — and the
 * bed, which runs on its own, waits for an explicit `all`.
 */
export const DEFAULT_SOUND_PREFERENCE: SoundPreference = "cues";

const listeners = new Set<() => void>();
/** Held only for a device that refuses storage, so a choice lasts the session. */
let unstoredPreference: SoundPreference | undefined;

function isSoundPreference(value: unknown): value is SoundPreference {
  return value === "off" || value === "cues" || value === "all";
}

export function readSoundPreference(): SoundPreference {
  try {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
    if (isSoundPreference(stored)) return stored;
  } catch {
    // Storage is optional; the session keeps whatever was chosen in it.
  }
  return unstoredPreference ?? DEFAULT_SOUND_PREFERENCE;
}

export function chooseSoundPreference(preference: SoundPreference): void {
  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, preference);
  } catch {
    unstoredPreference = preference;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSoundPreference(): SoundPreference {
  return useSyncExternalStore(
    subscribe,
    readSoundPreference,
    () => DEFAULT_SOUND_PREFERENCE,
  );
}

/**
 * Keeps the host's sound in step with the person's choice. Mounted once, at
 * the root, so every surface — sign-in included — hears the same answer.
 */
export function useSoundPreferenceSync(sound: SoundCapability): void {
  const preference = useSoundPreference();
  useEffect(() => {
    try {
      sound.setEnabled(preference !== "off");
    } catch {
      // Sound is presentation; a host that refuses it changes nothing else.
    }
  }, [preference, sound]);
}

/**
 * A stable function that plays a cue through whatever sound the host has, or
 * through nothing. It never throws: a cue never stands between a person and
 * what they did.
 */
export function useSoundCue(
  sound: SoundCapability | undefined,
): (cue: SoundCue) => void {
  return useCallback(
    (cue: SoundCue) => {
      try {
        sound?.play(cue);
      } catch {
        // Best-effort presentation; an unheard cue changes nothing.
      }
    },
    [sound],
  );
}
