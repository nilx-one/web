// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** The persistent world. It is the environment, never a peer navigation tab. */
export const WORLD_ROUTE = "/";
export const IDENTITY_ROUTE = "/identity";
export const SETTINGS_ROUTE = "/settings";

export type ShellRoute =
  typeof WORLD_ROUTE | typeof IDENTITY_ROUTE | typeof SETTINGS_ROUTE;

/** Which canonical route the shell is presenting. */
export type ShellSection = "world" | "identity" | "settings";

export function sectionRoute(section: ShellSection): ShellRoute {
  switch (section) {
    case "identity":
      return IDENTITY_ROUTE;
    case "settings":
      return SETTINGS_ROUTE;
    case "world":
      return WORLD_ROUTE;
  }
}
