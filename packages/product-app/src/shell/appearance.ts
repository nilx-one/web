// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useSyncExternalStore } from "react";

/**
 * What a person chose. `auto` defers to the device; `light` and `dark` are a
 * standing instruction that outlives whatever the device says.
 */
export type AppearancePreference = "light" | "dark" | "auto";

/** What the interface actually paints. `auto` is never a paintable value. */
export type ResolvedAppearance = "light" | "dark";

export const APPEARANCE_STORAGE_KEY = "nilx-one.interface.appearance";

/**
 * The document attribute every surface reads. One attribute on the root is
 * what keeps the sign-in surface and the world the same colour: the appearance
 * is resolved once, never a second time per surface.
 */
export const APPEARANCE_ATTRIBUTE = "data-appearance";

/** Host chrome outside the document, kept in step with the painted ground. */
const APPEARANCE_THEME_COLOR: Readonly<Record<ResolvedAppearance, string>> = {
  light: "#f3f8fc",
  dark: "#121116",
};

/**
 * Dark is only ever entered on evidence: a standing choice, or a device that
 * asks for it. A device that cannot answer the question resolves light — an
 * unknown answer must not open black on a person who never asked for one.
 */
export function resolveAppearance(
  preference: AppearancePreference,
  device: ResolvedAppearance,
): ResolvedAppearance {
  return preference === "auto" ? device : preference;
}

const DEVICE_DARK_QUERY = "(prefers-color-scheme: dark)";

// One media query list for the application's lifetime. `getSnapshot` runs on
// every render, so the device answer is read off a kept query rather than
// building a new one each time.
let deviceMedia: MediaQueryList | undefined;

function deviceQuery(): MediaQueryList | undefined {
  if (deviceMedia === undefined && window.matchMedia !== undefined) {
    deviceMedia = window.matchMedia(DEVICE_DARK_QUERY);
  }
  return deviceMedia;
}

/** The device's own answer, for hosts that have nothing better to say. */
export function deviceAppearance(): ResolvedAppearance {
  try {
    return deviceQuery()?.matches === true ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function readAppearancePreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // Storage is optional. The interface remains usable with the default.
  }
  return "auto";
}

// The device answer the host declared, when a host knows better than the
// media query — a Telegram or Discord client carries its own colour scheme.
let declaredDevice: ResolvedAppearance | undefined;

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function currentDevice(): ResolvedAppearance {
  return declaredDevice ?? deviceAppearance();
}

/**
 * The host's own colour scheme, which is what `auto` follows. Embedded hosts
 * answer for the device the media query cannot see from inside the frame.
 */
export function declareDeviceAppearance(device: ResolvedAppearance): void {
  if (declaredDevice === device) {
    return;
  }
  declaredDevice = device;
  notify();
}

/** A person's standing choice. Local presentation state, stored on the device. */
export function chooseAppearance(preference: AppearancePreference): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Persistence is best-effort only; the choice still applies this session.
  }
  notify();
}

// A single media subscription for the application's lifetime: the store is the
// one place the device answer is watched, so surfaces cannot drift apart.
let deviceWatched = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!deviceWatched) {
    const query = deviceQuery();
    if (query !== undefined) {
      query.addEventListener?.("change", notify);
      deviceWatched = true;
    }
  }

  return () => {
    listeners.delete(listener);
  };
}

export interface AppearanceState {
  readonly preference: AppearancePreference;
  readonly resolved: ResolvedAppearance;
}

/**
 * The appearance every surface reads. Preference and device answer are both
 * read from one store, so the sign-in surface and the world resolve the same
 * value in the same render instead of each deciding for itself.
 */
export function useAppearance(): AppearanceState {
  const preference = useSyncExternalStore(
    subscribe,
    readAppearancePreference,
    () => "auto" as AppearancePreference,
  );
  const device = useSyncExternalStore(
    subscribe,
    currentDevice,
    () => "light" as ResolvedAppearance,
  );

  return { preference, resolved: resolveAppearance(preference, device) };
}

/** Stamps the resolved appearance where the document and host chrome read it. */
export function applyAppearance(resolved: ResolvedAppearance): void {
  document.documentElement.setAttribute(APPEARANCE_ATTRIBUTE, resolved);
  document.head
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", APPEARANCE_THEME_COLOR[resolved]);
}
