// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  CatalogStore,
  createCatalogSnapshot,
  formatPrice,
  normalizeLocale,
} from "@0xda-market/webapp-core";
import { catalogTransport } from "./transport";

/**
 * The 0x1 host profile uses the shared Market engine, not its full-page DOM UI.
 * Restrict by the backend's category identity, never infer from a product name.
 */
export function createNilxOneMarketCatalog(request: typeof fetch = fetch) {
  const transport = catalogTransport(request);
  return {
    async load(locale: string) {
      const bootstrap = await transport.bootstrap({
        locale: normalizeLocale(locale),
      });
      const snapshot = createCatalogSnapshot(bootstrap);
      const store = new CatalogStore(snapshot, {
        pageSize: Math.max(1, snapshot.count),
      });
      store.setCategory("0x1");
      return store.view().products.map((product) => ({
        id: product.id,
        name: product.attributes.button_label || product.attributes.name,
        price: formatPrice(product),
      }));
    },
  };
}
