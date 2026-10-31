// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
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
    if (
      visitId === null ||
      orderId === null ||
      !/^[\w-]{43}$/.test(visitId) ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(orderId)
    ) {
      return { confirmed: false };
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
      if (!response.ok) return { confirmed: false };
      const body = (await response.json()) as {
        confirmed?: unknown;
        order_id?: unknown;
      };
      return {
        confirmed: body.confirmed === true && body.order_id === orderId,
      };
    } catch {
      return { confirmed: false };
    }
  };
}
