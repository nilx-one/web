// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { HostPort } from "@nilx-one/host-contract";
import {
  createNilxOneMarketCatalog,
  type MarketReturnCore,
} from "@nilx-one/market-host";

/**
 * The host's signed initData is its Bond credential. Without initData there
 * is no identity to authorize: send no header rather than an empty `tma `.
 */
export function telegramAuthorization(
  host: Pick<HostPort, "getSnapshot">,
): string | undefined {
  const authentication = host.getSnapshot().authentication;
  return authentication.kind === "telegram-init-data" &&
    authentication.initData.length > 0
    ? `tma ${authentication.initData}`
    : undefined;
}

/**
 * Market arrival in Telegram. Its presence is what parks xPing at the point
 * and opens the Market handoff, as on the site; without it every outbound
 * flight returns home.
 */
export function createTelegramMarketCatalog(
  host: Pick<HostPort, "getSnapshot">,
  request: typeof fetch = fetch,
  core?: MarketReturnCore,
) {
  return createNilxOneMarketCatalog(request, {
    authorization: () => telegramAuthorization(host),
    ...(core === undefined ? {} : { core }),
  });
}
