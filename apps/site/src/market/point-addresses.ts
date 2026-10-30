// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Market owns its point addresses: `https://0xda-market.nilx.one/{address}`,
 * e.g. `/zoloti` for the station `0xda-market-zoloti-vorota`. An address is a
 * location, not a display name (0xda-market/core
 * docs/architecture/market-point-addresses.md).
 */
export interface MarketPointAddress {
  readonly address: string;
  readonly station: string;
}

export interface MarketPointResolution extends MarketPointAddress {
  /** False for an older link: an alias, the station's place, other letter case. */
  readonly canonical: boolean;
}

const ADDRESS = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OWNER = "0xda-market-";

function parse(value: unknown): MarketPointAddress | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { address, station_pub_dress: station } = value as Record<
    string,
    unknown
  >;
  if (
    typeof address !== "string" ||
    address.length > 48 ||
    !ADDRESS.test(address) ||
    typeof station !== "string" ||
    !station.startsWith(OWNER) ||
    !ADDRESS.test(station.slice(OWNER.length))
  ) {
    return undefined;
  }
  return { address, station };
}

async function read(request: typeof fetch, path: string): Promise<unknown> {
  const response = await request(path, {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Market point addresses unavailable");
  return response.json();
}

/** Every registered point address. Malformed entries are dropped. */
export async function readMarketPointAddresses(
  request: typeof fetch = fetch,
): Promise<readonly MarketPointAddress[]> {
  const body = await read(request, "/nilx-browser/points");
  const points = (body as { points?: unknown } | null)?.points;
  if (!Array.isArray(points)) throw new Error("Malformed point addresses");
  return points.flatMap((point) => parse(point) ?? []);
}

/** The point a decoded path segment names, or null when Market knows none. */
export async function resolveMarketPointPath(
  segment: string,
  request: typeof fetch = fetch,
): Promise<MarketPointResolution | null> {
  const body = await read(
    request,
    `/nilx-browser/points/${encodeURIComponent(segment)}`,
  );
  if (body === null) return null;
  const point = (body as { point?: unknown }).point;
  const parsed = parse(point);
  const canonical = (point as { canonical?: unknown } | undefined)?.canonical;
  if (!parsed || typeof canonical !== "boolean") {
    throw new Error("Malformed point address");
  }
  return { ...parsed, canonical };
}
