// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { CourierPlan } from "@nilx-one/application";
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

const VISIT = "market_visit";
const ORDER = "market_order";

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

/**
 * The 0x1 side of the return flight. The query names an order; only Identity's
 * completion check, tied to this Bond's visit and receipt, confirms it.
 */
export function createMarketReturn(
  authorization?: () => string | undefined,
  request: typeof fetch = fetch,
): NonNullable<EmbeddedMarketCatalogPort["confirmReturn"]> {
  return async () => {
    const url = new URL(location.href);
    const visitId = url.searchParams.get(VISIT);
    const orderId = url.searchParams.get(ORDER);
    if (visitId === null && orderId === null) return undefined;
    // A reload or shared link must not ask again for the same order.
    url.searchParams.delete(VISIT);
    url.searchParams.delete(ORDER);
    history.replaceState(
      history.state,
      "",
      url.pathname + url.search + url.hash,
    );
    const trip = takeTrip();
    const flight = trip === undefined ? {} : { trip };
    if (
      visitId === null ||
      orderId === null ||
      !/^[\w-]{43}$/.test(visitId) ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(orderId)
    ) {
      return { confirmed: false, ...flight };
    }
    const token = authorization?.();
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
      if (!response.ok) return { confirmed: false, ...flight };
      const body = (await response.json()) as {
        confirmed?: unknown;
        order_id?: unknown;
      };
      return {
        confirmed: body.confirmed === true && body.order_id === orderId,
        ...flight,
      };
    } catch {
      return { confirmed: false, ...flight };
    }
  };
}

const TRIP = "nilx-one.market.trip";
const E7 = /^-?[0-9]{1,10}$/;

/** The tab's one pending return route; read once, whatever it holds. */
function takeTrip(): CourierPlan | undefined {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(TRIP);
    sessionStorage.removeItem(TRIP);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    const { version, plan } = JSON.parse(raw) as {
      version?: unknown;
      plan?: CourierPlan;
    };
    const point = (value: unknown) => {
      const { longitude_e7, latitude_e7 } = (value ?? {}) as Record<
        string,
        unknown
      >;
      return (
        typeof longitude_e7 === "string" &&
        E7.test(longitude_e7) &&
        typeof latitude_e7 === "string" &&
        E7.test(latitude_e7)
      );
    };
    return version === 1 &&
      plan !== undefined &&
      point(plan.origin) &&
      point(plan.destination?.coordinate) &&
      typeof plan.destination.pub_dress === "string"
      ? plan
      : undefined;
  } catch {
    return undefined;
  }
}
