// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  readPublicBondMapState,
  withoutPublicBondMapState,
  type PublicBondMapState,
} from "../identity/public-bond-handoff";
import type { PublicBondScreen } from "./public-bond-world";

/** The game a public Bond page returns to. */
export const PUBLIC_BOND_GAME_URL = "https://nilx.one/";

const STATE_KEY = "publicBondMap";

/**
 * Which screen an address opens: the Bond at its root, its Avaia under the
 * Avaia's own address, and nothing for anything else — a mistyped Avaia is
 * not silently the Bond.
 */
export function publicBondScreen(
  pathname: string,
  avaiaPubDress: string | undefined,
): PublicBondScreen {
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (path === "") return "bond";
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return "missing";
  }
  return avaiaPubDress !== undefined && decoded === avaiaPubDress
    ? "avaia"
    : "missing";
}

export function publicAvaiaPath(avaiaPubDress: string): string {
  return `/${encodeURIComponent(avaiaPubDress)}`;
}

/**
 * Reads the world state the game handed over in the fragment, keeps it in
 * this entry's history state so a reload or a step back finds it again, and
 * removes it from the address so a copied link stays the plain address.
 */
export function consumePublicBondMapState(
  browser: Pick<Window, "location" | "history">,
): PublicBondMapState {
  const handed = readPublicBondMapState(browser.location.hash);
  const stored: unknown = (browser.history.state as Record<string, unknown>)?.[
    STATE_KEY
  ];
  const kept =
    typeof stored === "string" ? readPublicBondMapState(stored) : undefined;
  const state =
    handed.camera !== undefined || handed.appearance !== undefined
      ? handed
      : (kept ?? {});
  const url = new URL(browser.location.href);
  const rest = withoutPublicBondMapState(url.hash);
  url.hash = rest;
  const carried = new URLSearchParams();
  if (state.camera !== undefined) {
    const { center, zoom, bearing, pitch } = state.camera;
    carried.set("map", [center[0], center[1], zoom, bearing, pitch].join(","));
  }
  if (state.appearance !== undefined)
    carried.set("appearance", state.appearance);
  browser.history.replaceState(
    {
      ...(browser.history.state as Record<string, unknown> | null),
      [STATE_KEY]: carried.toString(),
    },
    "",
    rest === "" ? `${url.pathname}${url.search}` : url.href,
  );
  return state;
}
