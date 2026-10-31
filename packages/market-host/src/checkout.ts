// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type {
  EmbeddedMarketCheckoutPort,
  EmbeddedMarketOrder,
} from "@nilx-one/product-app/business";

const STATUSES = new Set([
  "pending",
  "processing",
  "fulfilled",
  "rejected",
  "cancelled",
]);

/**
 * The Market page's own seeds checkout. It runs only on Market's origin with
 * the visit session cookie; the browser selects a Special SKU and its current
 * price, never a wallet, recipient or term. Identity settles the order.
 */
export function createMarketCheckout(
  request: typeof fetch = fetch,
): EmbeddedMarketCheckoutPort {
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await request(path, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      ...init,
      headers: { Accept: "application/json", ...init.headers },
    });
    if (!response.ok)
      throw new Error(`Checkout unavailable (${response.status})`);
    return (await response.json()) as unknown;
  };
  return {
    async offers() {
      const body = (await call("/nilx-browser/offers")) as { offers?: unknown };
      if (!Array.isArray(body.offers)) throw new Error("Invalid offers");
      return body.offers.flatMap((offer: Record<string, unknown>) =>
        typeof offer.sku === "string" &&
        typeof offer.price_id === "string" &&
        Number.isSafeInteger(offer.amount_minor) &&
        (offer.amount_minor as number) > 0 &&
        offer.denomination === "seeds"
          ? [
              {
                sku: offer.sku,
                priceId: offer.price_id,
                amountMinor: offer.amount_minor as number,
              },
            ]
          : [],
      );
    },
    async order(input) {
      return parseOrder(
        await call("/nilx-browser/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Market-Csrf": "1" },
          body: JSON.stringify({
            sku: input.sku,
            price_id: input.priceId,
            amount_minor: input.amountMinor,
            idempotency_key: input.idempotencyKey,
          }),
        }),
      );
    },
    async read(id) {
      return parseOrder(
        await call(`/nilx-browser/orders/${encodeURIComponent(id)}`),
      );
    },
  };
}

function parseOrder(body: unknown): EmbeddedMarketOrder {
  const { order, visit_id: visitId } = (body ?? {}) as {
    order?: { id?: unknown; attributes?: Record<string, unknown> };
    visit_id?: unknown;
  };
  const status = order?.attributes?.status;
  if (
    typeof order?.id !== "string" ||
    typeof status !== "string" ||
    !STATUSES.has(status)
  ) {
    throw new Error("Invalid order");
  }
  const code = order.attributes?.rejection_code;
  return {
    id: order.id,
    status: status as EmbeddedMarketOrder["status"],
    ...(typeof code === "string" ? { rejectionCode: code } : {}),
    ...(typeof visitId === "string" ? { visitId } : {}),
  };
}
