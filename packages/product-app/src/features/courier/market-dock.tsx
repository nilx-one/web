// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";
import type { CourierPlan } from "@nilx-one/application";
import { useLocalization } from "../../shell/localization";
import { DockWindow } from "../../shell/dock-window";
import { marketPointTitle } from "./market-points";
import "./market-dock.css";

export interface EmbeddedMarketProduct {
  readonly id: string;
  readonly name: string;
  readonly price: string | null;
}

/** The host supplies only the 0x1 catalog projection. It owns the transport. */
export interface EmbeddedMarketCatalogPort {
  load(locale: string): Promise<readonly EmbeddedMarketProduct[]>;
  beginVisit?(input: {
    point: string;
    seeds: string;
    avaia: { longitude: number; latitude: number };
    plan: CourierPlan;
  }): Promise<void>;
}

const messages = {
  "uk-UA": {
    back: "До маркету",
    preview: "Розташування точки ще не підтверджено",
    loading: "Завантаження товарів…",
    failed: "Не вдалося завантажити товари.",
    retry: "Повторити",
    empty: "Товарів 0x1 наразі немає.",
    unavailable: "Ціна недоступна",
    browseOnly: "Придбання за seeds ще не підключено.",
    license: "0xda-market · ліцензія MIT",
  },
  "ru-RU": {
    back: "К маркету",
    preview: "Расположение точки ещё не подтверждено",
    loading: "Загрузка товаров…",
    failed: "Не удалось загрузить товары.",
    retry: "Повторить",
    empty: "Товаров 0x1 пока нет.",
    unavailable: "Цена недоступна",
    browseOnly: "Покупка за seeds ещё не подключена.",
    license: "0xda-market · лицензия MIT",
  },
  en: {
    back: "Back to market",
    preview: "Point location is not verified yet",
    loading: "Loading products…",
    failed: "Unable to load products.",
    retry: "Retry",
    empty: "No 0x1 products are available yet.",
    unavailable: "Price unavailable",
    browseOnly: "Purchases with seeds are not connected yet.",
    license: "0xda-market · MIT License",
  },
};

type CatalogState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; products: readonly EmbeddedMarketProduct[] };

/** Native 0x1 Dock content. No iframe, marketplace tabs or category selector. */
export function MarketDock({
  plan,
  catalog,
  onClose,
}: {
  plan: CourierPlan;
  catalog: EmbeddedMarketCatalogPort;
  onClose(): void;
}) {
  const { resolved: locale } = useLocalization();
  const copy = messages[locale];
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    let live = true;
    void catalog.load(locale).then(
      (products) => {
        if (live) setState({ kind: "ready", products });
      },
      () => {
        if (live) setState({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [catalog, locale, retry]);

  const selected =
    state.kind === "ready"
      ? state.products.find((product) => product.id === selectedId)
      : undefined;

  return (
    <section className="market-dock" aria-label="0xda-market 0x1">
      <DockWindow screen="market" depth={1}>
        <header className="market-dock__header">
          <button type="button" onClick={onClose}>
            {copy.back}
          </button>
          <strong>{marketPointTitle(plan.destination, locale)}</strong>
        </header>
        {!plan.destination.isVerified && (
          <p className="market-dock__notice">{copy.preview}</p>
        )}
        <div className="market-dock__body">
          <h2 className="market-dock__category">0x1</h2>
          {state.kind === "loading" && <p role="status">{copy.loading}</p>}
          {state.kind === "failed" && (
            <div role="alert">
              <p>{copy.failed}</p>
              <button
                type="button"
                onClick={() => {
                  setState({ kind: "loading" });
                  setSelectedId(undefined);
                  setRetry((value) => value + 1);
                }}
              >
                {copy.retry}
              </button>
            </div>
          )}
          {state.kind === "ready" && state.products.length === 0 && (
            <p role="status">{copy.empty}</p>
          )}
          {state.kind === "ready" && state.products.length > 0 && (
            <div className="market-dock__products">
              {state.products.map((product) => (
                <button
                  type="button"
                  className="market-dock__product"
                  key={product.id}
                  aria-pressed={selectedId === product.id}
                  onClick={() =>
                    setSelectedId((id) =>
                      id === product.id ? undefined : product.id,
                    )
                  }
                >
                  <strong>{product.name}</strong>
                  <span>{product.price ?? copy.unavailable}</span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <section className="market-dock__detail" aria-live="polite">
              <h3>{selected.name}</h3>
              <p>{selected.price ?? copy.unavailable}</p>
              <p>{copy.browseOnly}</p>
            </section>
          )}
          <a
            className="market-dock__license"
            href="/market-license.txt"
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.license}
          </a>
        </div>
      </DockWindow>
    </section>
  );
}
