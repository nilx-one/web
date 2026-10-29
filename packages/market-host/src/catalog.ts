// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createCatalogSnapshot,
  formatPrice,
  normalizeLocale,
} from "@0xda-market/webapp-core";
import { catalogTransport } from "./transport";
import { createMarketVisit } from "./visit";

export interface MarketHostOptions {
  /** The host's own Bond credential for the Identity handoff, if any. */
  readonly authorization?: () => string | undefined;
}

/**
 * The 0x1 host profile uses the shared Market engine, not its full-page DOM UI.
 * Restrict by the backend's category identity, never infer from a product name.
 */
export function createNilxOneMarketCatalog(
  request: typeof fetch = fetch,
  options: MarketHostOptions = {},
) {
  const transport = catalogTransport(request);
  const cache = new Map<
    string,
    {
      expires: number;
      result: Promise<
        readonly { id: string; name: string; price: string | null }[]
      >;
    }
  >();
  return {
    beginVisit: createMarketVisit(options.authorization),
    async load(locale: string) {
      const key = normalizeLocale(locale);
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return cached.result;
      const result = (async () => {
        const bootstrap = await transport.bootstrap({
          locale: key,
        });
        const snapshot = createCatalogSnapshot(bootstrap);
        const order = ["exclusive", "special"].flatMap((tier) =>
          [1, 3, 6, 12].map((months) => `0x1_${tier}_${months}m`),
        );
        const rank = (id: string) => {
          const i = order.indexOf(id);
          return i < 0 ? order.length : i;
        };
        return snapshot.products
          .filter(
            (p) =>
              p.category.id === "0x1" ||
              p.attributes.metadata?.family === "0x1_subscription",
          )
          .sort((a, b) => rank(a.id) - rank(b.id))
          .map((product) => ({
            id: product.id,
            name: product.attributes.button_label || product.attributes.name,
            price:
              product.attributes.preview && product.attributes.preview_price
                ? `${product.attributes.preview_price.amount} ${product.attributes.preview_price.currency}`
                : formatPrice(product),
          }));
      })();
      cache.set(key, { expires: Date.now() + 60_000, result });
      try {
        return await result;
      } catch (error) {
        if (cache.get(key)?.result === result) cache.delete(key);
        throw error;
      }
    },
  };
}
