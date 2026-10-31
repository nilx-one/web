// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

const VISIT = "market_visit";
const ORDER = "market_order";
const TRIP = "nilx-one.market.trip";
// An unconfirmed return stays identifiable and is asked about again, because
// Identity may only have been unreachable; for a day, then the order is let go.
// The route itself stays until the tab is closed or a confirmation uses it.
const PENDING_MS = 24 * 60 * 60_000;

/** Where Market sends the tab back to after a fulfilled order. */
export function marketReturnUrl(input: {
  returnPath: string;
  visitId: string;
  orderId: string;
}): string {
  // Market only accepts host pages such as `/` or `/telegram/`.
  const path = /^\/(?:[a-z0-9-]+\/)?$/.test(input.returnPath)
    ? input.returnPath
    : "/";
  const url = new URL(path, "https://nilx.one");
  url.searchParams.set(VISIT, input.visitId);
  url.searchParams.set(ORDER, input.orderId);
  return url.href;
}

interface Pending {
  readonly visitId: string;
  readonly orderId: string;
  /** When the tab came back from Market with this order. */
  readonly since: number;
}

interface TripRecord {
  readonly version: 1;
  readonly plan: CourierPlan;
  readonly pending?: Pending;
}

/**
 * The 0x1 side of the return flight. The query names an order; only Identity's
 * completion check, tied to this Bond's visit and receipt, confirms it. The
 * tab's route home is handed back only with a confirmed purchase; until then
 * it stays, with the order, and `retry` says the order can be asked about
 * again. The client never confirms a purchase itself.
 */
export function createMarketReturn(
  authorization?: () => string | undefined,
  request: typeof fetch = fetch,
): NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]> {
  return async () => {
    const url = new URL(location.href);
    const queried = url.searchParams.has(VISIT) || url.searchParams.has(ORDER);
    const record = readTrip();
    let ask: Pending;
    if (queried) {
      const visitId = url.searchParams.get(VISIT);
      const orderId = url.searchParams.get(ORDER);
      // A reload or shared link must not ask again for the same order.
      url.searchParams.delete(VISIT);
      url.searchParams.delete(ORDER);
      history.replaceState(
        history.state,
        "",
        url.pathname + url.search + url.hash,
      );
      if (
        visitId === null ||
        orderId === null ||
        !validReturn(visitId, orderId)
      )
        return { confirmed: false };
      ask = { visitId, orderId, since: Date.now() };
    } else if (record?.pending) {
      ask = record.pending;
    } else {
      return undefined;
    }

    const confirmed = await confirm(ask, authorization?.(), request);
    if (confirmed) {
      removeTrip();
      return record ? { confirmed, trip: record.plan } : { confirmed };
    }
    const open = Date.now() - ask.since < PENDING_MS;
    if (record) {
      writeTrip(
        open ? { ...record, pending: ask } : { version: 1, plan: record.plan },
      );
    }
    return record && open ? { confirmed, retry: true } : { confirmed };
  };
}

function validReturn(visitId: string, orderId: string): boolean {
  return (
    /^[\w-]{43}$/.test(visitId) && /^[A-Za-z0-9._:-]{1,128}$/.test(orderId)
  );
}

async function confirm(
  { visitId, orderId }: Pending,
  token: string | undefined,
  request: typeof fetch,
): Promise<boolean> {
  try {
    const response = await request(
      `/api/v1/identity/market-return?visit_id=${encodeURIComponent(visitId)}&order_id=${encodeURIComponent(orderId)}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          ...(token ? { authorization: token } : {}),
        },
      },
    );
    if (!response.ok) return false;
    const body = (await response.json()) as {
      confirmed?: unknown;
      order_id?: unknown;
    };
    return body.confirmed === true && body.order_id === orderId;
  } catch {
    return false;
  }
}

const E7 = /^-?[0-9]{1,10}$/;
const STATION = /^0xda-market-[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

function coordinate(value: unknown): boolean {
  const { longitude_e7, latitude_e7 } = (value ?? {}) as Record<
    string,
    unknown
  >;
  if (
    typeof longitude_e7 !== "string" ||
    typeof latitude_e7 !== "string" ||
    !E7.test(longitude_e7) ||
    !E7.test(latitude_e7)
  ) {
    return false;
  }
  const longitude = Number(longitude_e7) / 1e7;
  const latitude = Number(latitude_e7) / 1e7;
  return Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;
}

function station(value: unknown): boolean {
  const { id, pub_dress } = (value ?? {}) as {
    id?: { owner_pub_dress?: unknown; number?: unknown };
    pub_dress?: unknown;
  };
  return (
    id?.owner_pub_dress === "0xda-market" &&
    Number.isSafeInteger(id.number) &&
    typeof pub_dress === "string" &&
    STATION.test(pub_dress)
  );
}

function isPending(value: unknown): value is Pending {
  const { visitId, orderId, since } = (value ?? {}) as Record<string, unknown>;
  return (
    typeof visitId === "string" &&
    typeof orderId === "string" &&
    validReturn(visitId, orderId) &&
    typeof since === "number" &&
    Number.isSafeInteger(since) &&
    since <= Date.now() &&
    Date.now() - since < PENDING_MS
  );
}

/** The tab's route out to Market if it is a real one; a broken one is dropped. */
function readTrip(): TripRecord | undefined {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(TRIP);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const record = JSON.parse(raw) as {
      version?: unknown;
      plan?: CourierPlan;
      pending?: unknown;
    };
    const plan = record.plan;
    if (
      record.version !== 1 ||
      plan === undefined ||
      !coordinate(plan.origin) ||
      !coordinate(plan.destination?.coordinate) ||
      !station(plan.destination)
    ) {
      removeTrip();
      return undefined;
    }
    if (isPending(record.pending))
      return { version: 1, plan, pending: record.pending };
    // A stale or broken order is let go; the route stays.
    if (record.pending !== undefined) writeTrip({ version: 1, plan });
    return { version: 1, plan };
  } catch {
    removeTrip();
    return undefined;
  }
}

function writeTrip(record: TripRecord) {
  try {
    sessionStorage.setItem(TRIP, JSON.stringify(record));
  } catch {
    // Without storage the order is simply not asked about again.
  }
}

function removeTrip() {
  try {
    sessionStorage.removeItem(TRIP);
  } catch {
    // Nothing was kept.
  }
}
