// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/** Public projection from the pinned, JavaScript-only Market engine. */
declare module "@0xda-market/webapp-core" {
  interface MarketProduct {
    readonly id: string;
    readonly category: { readonly id: string };
    readonly attributes: {
      readonly name: string;
      readonly button_label?: string;
      readonly price?: { readonly amount: string; readonly currency: string } | null;
    };
  }

  interface CatalogSnapshot {
    readonly count: number;
    readonly products: readonly MarketProduct[];
  }

  export function createCatalogSnapshot(bootstrap: unknown): CatalogSnapshot;
  export class CatalogStore {
    constructor(snapshot: CatalogSnapshot, options?: { pageSize?: number });
    setCategory(category: string | null): unknown;
    view(): { readonly products: readonly MarketProduct[] };
  }
  export function formatPrice(product: MarketProduct): string | null;
}
