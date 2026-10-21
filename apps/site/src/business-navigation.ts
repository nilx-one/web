// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BusinessNavigationPort,
  BusinessNavigationState,
} from "@nilx-one/application";

const validLabel = (s: string) =>
  /^(?:0x|xn--)[a-z0-9-]+$/.test(s) && s.length <= 63;
const validCity = (s: unknown): s is string =>
  typeof s === "string" && /^[\p{L}\p{N}._:-]{1,128}$/u.test(s);
const validPoint = (s: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s);

/** Reads only a city hint, never credentials or raw coordinates; remove it from copyable URLs. */
export function consumeCityHandoff(
  browser: Window = window,
): string | undefined {
  const hash = new URLSearchParams(browser.location.hash.slice(1));
  const city = hash.get("business-city");
  if (city === null) return undefined;
  hash.delete("business-city");
  const url = new URL(browser.location.href);
  url.hash = hash.toString();
  browser.history.replaceState(browser.history.state, "", url);
  return validCity(city) ? city : undefined;
}

export function createBusinessNavigation(
  publicLabel?: string,
  browser: Window = window,
): BusinessNavigationPort {
  const listeners = new Set<() => void>();
  const incomingCity = consumeCityHandoff(browser);
  const read = (): BusinessNavigationState | null => {
    const url = new URL(browser.location.href);
    const label = publicLabel ?? url.searchParams.get("business");
    if (!label || !validLabel(label)) return null;
    const rawPoint =
      publicLabel === undefined
        ? (url.searchParams.get("point") ?? "")
        : url.pathname.replace(/^\//, "").replace(/\/$/, "");
    const stored = browser.history.state?.businessCity;
    const cityId = validCity(stored) ? stored : incomingCity;
    // Malformed deep paths stay unavailable, never silently resolve to the organization.
    const point =
      rawPoint === ""
        ? undefined
        : validPoint(rawPoint)
          ? rawPoint
          : "!invalid";
    return {
      label,
      ...(point === undefined ? {} : { point }),
      ...(cityId === undefined ? {} : { cityId }),
    };
  };
  let snapshot = read();
  const changed = () => {
    snapshot = read();
    listeners.forEach((listener) => listener());
  };
  const href = (label: string, point?: string) => {
    if (!validLabel(label) || (point !== undefined && !validPoint(point)))
      throw new Error("Invalid business navigation");
    return publicLabel === label
      ? `/${point ?? ""}`
      : `/?business=${encodeURIComponent(label)}${point === undefined ? "" : `&point=${encodeURIComponent(point)}`}`;
  };
  return {
    getSnapshot: () => snapshot,
    sync: changed,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        browser.addEventListener("popstate", changed);
        snapshot = read();
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0)
          browser.removeEventListener("popstate", changed);
      };
    },
    href,
    open: (label, point, cityId) => {
      if (cityId !== undefined && !validCity(cityId)) return;
      browser.history.pushState(
        { ...browser.history.state, businessCity: cityId ?? null },
        "",
        href(label, point),
      );
      changed();
    },
    close: () => {
      if (publicLabel !== undefined) {
        browser.location.assign("https://nilx.one/");
        return;
      }
      const url = new URL(browser.location.href);
      url.searchParams.delete("business");
      url.searchParams.delete("point");
      browser.history.pushState(
        { ...browser.history.state, businessCity: null },
        "",
        url,
      );
      changed();
    },
  };
}
