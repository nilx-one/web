// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BusinessCatalog,
  BusinessCity,
  BusinessContact,
  BusinessPointSurface,
  BusinessSurface,
  BusinessSurfacePort,
  BusinessSurfaceResult,
} from "@nilx-one/application";

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 2048;
const route = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v) &&
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
  ].includes(v);
const contacts = (v: unknown): v is BusinessContact[] =>
  Array.isArray(v) &&
  v.length <= 32 &&
  v.every((x) => record(x) && str(x.label) && str(x.href));
function catalog(v: unknown): v is BusinessCatalog {
  if (!record(v)) return false;
  if (v.kind === "unavailable") return true;
  return (
    v.kind === "ready" &&
    Array.isArray(v.offers) &&
    v.offers.length <= 100 &&
    v.offers.every(
      (x) =>
        record(x) &&
        str(x.id) &&
        str(x.name) &&
        str(x.category) &&
        (x.quantity === undefined || str(x.quantity)) &&
        (x.price === undefined || str(x.price)),
    ) &&
    new Set(v.offers.map((x) => (x as { id: string }).id)).size ===
      v.offers.length
  );
}
function city(v: unknown): v is BusinessCity {
  if (
    !record(v) ||
    !str(v.id) ||
    !str(v.name) ||
    !str(v.country) ||
    (v.region !== undefined && !str(v.region)) ||
    !Array.isArray(v.aliases) ||
    !v.aliases.every(str)
  )
    return false;
  return (
    v.boundary === undefined ||
    (Array.isArray(v.boundary) &&
      v.boundary.length >= 3 &&
      v.boundary.length <= 10000 &&
      v.boundary.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          typeof p[0] === "number" &&
          Number.isFinite(p[0]) &&
          Math.abs(p[0]) <= 180 &&
          typeof p[1] === "number" &&
          Number.isFinite(p[1]) &&
          Math.abs(p[1]) <= 90,
      ))
  );
}
function point(v: unknown): v is BusinessPointSurface {
  return (
    record(v) &&
    record(v.id) &&
    str(v.id.owner_pub_dress) &&
    typeof v.id.number === "number" &&
    Number.isInteger(v.id.number) &&
    v.id.number >= 0 &&
    v.id.number <= 255 &&
    route(v.route) &&
    str(v.displayName) &&
    str(v.cityId) &&
    contacts(v.contacts) &&
    catalog(v.catalog)
  );
}
export function parseBusinessSurface(
  value: unknown,
  label: string,
): BusinessSurface | undefined {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !str(value.pubDress) ||
    !str(value.publicUrl) ||
    !str(value.displayName) ||
    !contacts(value.contacts) ||
    !record(value.directory)
  )
    return undefined;
  try {
    const url = new URL(value.publicUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== `${label}.nilx.one` ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return undefined;
  } catch {
    return undefined;
  }
  if (value.directory.kind === "unavailable")
    return value as unknown as BusinessSurface;
  const { cities, points } = value.directory;
  if (
    value.directory.kind !== "ready" ||
    !Array.isArray(cities) ||
    cities.length > 10000 ||
    !cities.every(city) ||
    !Array.isArray(points) ||
    points.length > 256 ||
    !points.every(point)
  )
    return undefined;
  if (
    new Set(cities.map((c) => c.id)).size !== cities.length ||
    new Set(points.map((p) => p.route)).size !== points.length ||
    new Set(points.map((p) => `${p.id.owner_pub_dress}:${p.id.number}`))
      .size !== points.length ||
    points.some((p) => !cities.some((c) => c.id === p.cityId))
  )
    return undefined;
  // ID owner strings are allocation-time handles, not necessarily the current pub_dress.
  return value as unknown as BusinessSurface;
}
export function createBusinessSurfaceHttp(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): BusinessSurfacePort {
  return {
    async read(label, signal): Promise<BusinessSurfaceResult> {
      if (!/^(?:0x|xn--)[a-z0-9-]+$/.test(label) || label.length > 63)
        return { kind: "not-found" };
      try {
        const response = await fetchImpl(
          `/api/v1/identity/business?label=${encodeURIComponent(label)}`,
          {
            credentials: "omit",
            cache: "no-store",
            ...(signal === undefined ? {} : { signal }),
          },
        );
        if (response.status === 404) {
          const body: unknown = await response.json().catch(() => null);
          return record(body) &&
            record(body.error) &&
            body.error.code === "public_bond_not_found"
            ? { kind: "not-found" }
            : { kind: "unavailable" };
        }
        if (!response.ok) return { kind: "unavailable" };
        const business = parseBusinessSurface(await response.json(), label);
        return business === undefined
          ? { kind: "unavailable" }
          : { kind: "ready", business };
      } catch {
        return { kind: "unavailable" };
      }
    },
  };
}
