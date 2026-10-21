// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BusinessCity } from "@nilx-one/application";
import type { ObservedGeolocation } from "@nilx-one/host-contract";

const fold = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
export function searchBusinessCities(
  cities: readonly BusinessCity[],
  query: string,
): readonly BusinessCity[] {
  const words = fold(query).trim().split(/\s+/);
  return cities.filter((city) => {
    const text = fold(
      [city.name, city.country, city.region ?? "", ...city.aliases].join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}

function inside(
  p: readonly [number, number],
  polygon: readonly (readonly [number, number])[],
): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

/** No nearest-shop inference. Only a unique published boundary can suggest a city. */
export function cityForObservation(
  cities: readonly BusinessCity[],
  position: ObservedGeolocation,
): string | undefined {
  if (
    position.declared ||
    !Number.isFinite(position.longitude) ||
    !Number.isFinite(position.latitude)
  )
    return undefined;
  const matches = cities.filter(
    (city) =>
      city.boundary !== undefined &&
      inside([position.longitude, position.latitude], city.boundary),
  );
  return matches.length === 1 ? matches[0]!.id : undefined;
}

export function safeBusinessContact(href: string): string | undefined {
  if (
    /\s/u.test(href) ||
    [...href].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return undefined;
  try {
    const url = new URL(href);
    if (url.protocol === "https:" && !url.username && !url.password)
      return url.href;
    if (
      url.protocol === "mailto:" &&
      /^[^?&#]+@[^?&#]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    )
      return url.href;
    if (
      url.protocol === "tel:" &&
      /^\+?[0-9().-]+$/.test(url.pathname) &&
      !url.search &&
      !url.hash
    )
      return url.href;
  } catch {
    /* Invalid published contact is omitted. */
  }
  return undefined;
}

export function validPointRoute(route: string): boolean {
  return (
    /^[a-z0-9][a-z0-9_-]{0,63}$/.test(route) &&
    ![
      "auth",
      "api",
      "assets",
      "map",
      "core",
      "identity",
      "settings",
      "telegram",
      "business",
    ].includes(route)
  );
}
