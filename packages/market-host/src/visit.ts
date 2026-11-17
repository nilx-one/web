// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import type { EmbeddedMarketCatalogPort } from "@nilx-one/product-app/business";

/**
 * A host without the site's native session cookie proves its Bond with its
 * own credential, for example Telegram `tma` initData. Absent, the request
 * relies on the same-origin cookie only.
 */
export function createMarketVisit(
  authorization?: () => string | undefined,
): NonNullable<EmbeddedMarketCatalogPort["beginVisit"]> {
  return (input) => beginMarketVisit(input, authorization?.());
}

/**
 * Identity refused to open the Market. The code is Identity's own error code,
 * so the departure screen can say why instead of asking for a blind retry.
 */
export class MarketVisitRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`Market visit refused: ${code ?? status}`);
    this.name = "MarketVisitRefused";
  }
}

/**
 * The trusted same-origin Identity endpoint supplies the exact Market action.
 * The browser does not invent a production URL when TEST Identity is in use.
 * Treat response fields as untrusted until the HTTPS exchange route is checked.
 */
export function marketExchangeAction(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing Market exchange");
  const action = new URL(value);
  if (
    action.protocol !== "https:" ||
    !action.hostname ||
    action.username ||
    action.password ||
    action.pathname !== "/nilx-browser/exchange" ||
    action.search ||
    action.hash
  ) {
    throw new Error("Invalid Market exchange");
  }
  return action.href;
}

async function beginMarketVisit(
  input: Parameters<NonNullable<EmbeddedMarketCatalogPort["beginVisit"]>>[0],
  authorization: string | undefined,
): Promise<void> {
  // The optional return-trip hint is not required to authenticate at Market.
  // Blocked storage must not prevent an otherwise valid server handoff.
  try {
    if (input.plan) {
      sessionStorage.setItem(
        "nilx-one.market.trip",
        JSON.stringify({ version: 1, plan: input.plan }),
      );
    } else {
      // An Avaia/Bond visit is not an xPing flight. A previous trip in this
      // tab must not send a courier home from a manual pickup.
      sessionStorage.removeItem("nilx-one.market.trip");
    }
  } catch {
    // This tab can still browse Market; return-flight integration is separate.
  }
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  input.signal?.addEventListener("abort", onCancel, { once: true });
  const timeout = setTimeout(onCancel, 15_000);
  try {
    if (input.signal?.aborted) throw new Error("Market visit cancelled");
    const response = await fetch("/api/v1/identity/market-visit", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "x-0x1-csrf": "1",
        ...(authorization ? { authorization } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        point: input.point,
        // The server reads seeds from the authoritative Identity wallet.
        // Never ship a browser inventory amount across the market handoff.
        // Identity refuses unknown fields. A remembered position also
        // carries a bearing, so name the two the contract takes.
        avaia: {
          longitude: input.avaia.longitude,
          latitude: input.avaia.latitude,
        },
        ...(input.pickupOrderId
          ? { pickup_order_id: input.pickupOrderId }
          : {}),
        return_path: /^\/(?:[a-z0-9-]+\/)?$/.test(location.pathname)
          ? location.pathname
          : "/",
      }),
    });
    if (!response.ok) {
      const code = await response
        .json()
        .then((body: { error?: { code?: unknown } }) =>
          typeof body?.error?.code === "string" ? body.error.code : undefined,
        )
        .catch(() => undefined);
      throw new MarketVisitRefused(response.status, code);
    }
    const body = (await response.json()) as {
      code?: unknown;
      action?: unknown;
    };
    if (typeof body.code !== "string" || !/^[\w-]{43}$/.test(body.code))
      throw new Error("Invalid handoff");
    // Do not navigate after a changed selection cancels the old request.
    if (controller.signal.aborted) throw new Error("Market visit cancelled");
    const form = document.createElement("form");
    form.method = "POST";
    form.action = marketExchangeAction(body.action);
    const code = document.createElement("input");
    code.type = "hidden";
    code.name = "code";
    code.value = body.code;
    form.append(code);
    document.body.append(form);
    form.submit();
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", onCancel);
  }
}
