// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from "react";
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
    /** Abort a stale handoff if the selected arrival changes. */
    signal?: AbortSignal;
  }): Promise<void>;
  /**
   * The 0x1 side of a return from Market: whether Identity confirms the order
   * named by this page's address. Undefined when the page is not a return.
   */
  confirmReturn?(): Promise<{ confirmed: boolean } | undefined>;
}

export interface EmbeddedMarketOffer {
  readonly sku: string;
  readonly priceId: string;
  readonly amountMinor: number;
}

export interface EmbeddedMarketOrder {
  readonly id: string;
  readonly status:
    "pending" | "processing" | "fulfilled" | "rejected" | "cancelled";
  readonly rejectionCode?: string;
  readonly visitId?: string;
}

/**
 * Market's seeds checkout for this visit. The Dock picks a Special SKU and its
 * current price; Identity settles it and the order reports the outcome.
 */
export interface EmbeddedMarketCheckoutPort {
  offers(): Promise<readonly EmbeddedMarketOffer[]>;
  order(input: {
    sku: string;
    priceId: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<EmbeddedMarketOrder>;
  read(id: string): Promise<EmbeddedMarketOrder>;
}

const ORDER_POLL_MS = 2_000;
// Market holds a pending authorization for 15 minutes.
const ORDER_WAIT_MS = 15 * 60_000;

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
    buy: "Купити за {amount} seeds",
    placing: "Оформлюємо замовлення…",
    waiting: "Очікуємо підтвердження від 0x1…",
    purchased: "Придбано. Повертаємось до 0x1…",
    rejected: "Покупку відхилено.",
    insufficient: "Недостатньо seeds.",
    purchaseFailed: "Не вдалося оформити покупку.",
    tryAgain: "Спробувати ще раз",
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
    buy: "Купить за {amount} seeds",
    placing: "Оформляем заказ…",
    waiting: "Ожидаем подтверждения от 0x1…",
    purchased: "Куплено. Возвращаемся в 0x1…",
    rejected: "Покупка отклонена.",
    insufficient: "Недостаточно seeds.",
    purchaseFailed: "Не удалось оформить покупку.",
    tryAgain: "Попробовать ещё раз",
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
    buy: "Buy for {amount} seeds",
    placing: "Placing the order…",
    waiting: "Waiting for 0x1 to confirm…",
    purchased: "Purchased. Returning to 0x1…",
    rejected: "The purchase was declined.",
    insufficient: "Not enough seeds.",
    purchaseFailed: "Unable to complete the purchase.",
    tryAgain: "Try again",
  },
};

type CatalogState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; products: readonly EmbeddedMarketProduct[] };

type PurchaseState =
  | { kind: "idle" }
  | { kind: "placing" }
  | { kind: "waiting" }
  | { kind: "purchased" }
  | { kind: "rejected"; code: string | undefined }
  | { kind: "failed" };

/** Native 0x1 Dock content. No iframe, marketplace tabs or category selector. */
export function MarketDock({
  plan,
  catalog,
  checkout,
  onPurchased,
  onClose,
}: {
  plan: CourierPlan;
  catalog: EmbeddedMarketCatalogPort;
  /** Absent, the Dock only browses: no purchase is offered. */
  checkout?: EmbeddedMarketCheckoutPort;
  /** A fulfilled order; the host takes the tab back to 0x1. */
  onPurchased?(order: EmbeddedMarketOrder): void;
  onClose(): void;
}) {
  const { resolved: locale } = useLocalization();
  const copy = messages[locale];
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [selectedId, setSelectedId] = useState<string>();
  const [offers, setOffers] = useState<readonly EmbeddedMarketOffer[]>([]);
  const [purchase, setPurchase] = useState<PurchaseState>({ kind: "idle" });
  // One key per chosen offer: a retry after a lost reply replays the order.
  const attempt = useRef<{ sku: string; key: string }>(undefined);
  const purchased = useRef(onPurchased);
  purchased.current = onPurchased;

  useEffect(() => {
    if (!checkout) return;
    let live = true;
    void checkout.offers().then(
      (list) => {
        if (live) setOffers(list);
      },
      () => {
        // Without offers the Dock still browses the catalog.
        if (live) setOffers([]);
      },
    );
    return () => {
      live = false;
    };
  }, [checkout, retry]);

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
  const offer = selected && offers.find((item) => item.sku === selected.id);

  useEffect(() => {
    attempt.current = undefined;
    setPurchase({ kind: "idle" });
  }, [selectedId]);

  const buy = async (chosen: EmbeddedMarketOffer) => {
    if (!checkout) return;
    if (attempt.current?.sku !== chosen.sku)
      attempt.current = { sku: chosen.sku, key: crypto.randomUUID() };
    const { key } = attempt.current;
    setPurchase({ kind: "placing" });
    try {
      let order = await checkout.order({
        sku: chosen.sku,
        priceId: chosen.priceId,
        amountMinor: chosen.amountMinor,
        idempotencyKey: key,
      });
      const deadline = Date.now() + ORDER_WAIT_MS;
      setPurchase({ kind: "waiting" });
      while (order.status === "pending" || order.status === "processing") {
        if (Date.now() > deadline) throw new Error("Order not settled");
        await new Promise((resolve) => setTimeout(resolve, ORDER_POLL_MS));
        if (attempt.current?.key !== key) return;
        order = await checkout.read(order.id);
      }
      if (attempt.current?.key !== key) return;
      // A settled order is final; another try is a new order.
      attempt.current = undefined;
      if (order.status === "fulfilled") {
        setPurchase({ kind: "purchased" });
        purchased.current?.(order);
      } else {
        setPurchase({ kind: "rejected", code: order.rejectionCode });
      }
    } catch {
      if (attempt.current?.key === key) setPurchase({ kind: "failed" });
    }
  };
  const busy = purchase.kind === "placing" || purchase.kind === "waiting";

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
              {offer ? (
                <>
                  {purchase.kind !== "purchased" && (
                    <button
                      type="button"
                      className="market-dock__buy"
                      disabled={busy}
                      onClick={() => void buy(offer)}
                    >
                      {purchase.kind === "failed" ||
                      purchase.kind === "rejected"
                        ? copy.tryAgain
                        : copy.buy.replace(
                            "{amount}",
                            String(offer.amountMinor),
                          )}
                    </button>
                  )}
                  {purchase.kind !== "idle" && (
                    <p
                      role={
                        purchase.kind === "failed" ||
                        purchase.kind === "rejected"
                          ? "alert"
                          : "status"
                      }
                    >
                      {purchase.kind === "placing"
                        ? copy.placing
                        : purchase.kind === "waiting"
                          ? copy.waiting
                          : purchase.kind === "purchased"
                            ? copy.purchased
                            : purchase.kind === "rejected"
                              ? purchase.code === "insufficient_seeds"
                                ? copy.insufficient
                                : copy.rejected
                              : copy.purchaseFailed}
                    </p>
                  )}
                </>
              ) : (
                <p>{copy.browseOnly}</p>
              )}
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
