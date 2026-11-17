// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { ProductLocale } from "../../shell/localization";
import type { PaidSpecialItem } from "./market-dock";
import "./special-pickup-notice.css";

const copy = {
  "uk-UA": {
    title: "Special оплачено",
    message: "Твій Special на 1 місяць чекає на отримання в 0xda-market.",
    action: "Відправити xPing",
    pending: "xPing уже вирушає або очікує.",
  },
  "ru-RU": {
    title: "Special оплачен",
    message: "Твой Special на 1 месяц ожидает получения в 0xda-market.",
    action: "Отправить xPing",
    pending: "xPing уже отправляется или ожидает.",
  },
  en: {
    title: "Special paid",
    message: "Your one-month Special is ready for collection at 0xda-market.",
    action: "Send xPing",
    pending: "xPing is already departing or waiting.",
  },
} as const;

/**
 * Persistent pickup prompts are derived exclusively from Identity's paid items.
 * No dismiss action is exposed: navigation, reload or a second host must not
 * acknowledge payment or collect an item. A click only starts the courier flow.
 */
export function SpecialPickupNotice({
  items,
  locale,
  dispatching,
  onSendXping,
}: {
  items: readonly PaidSpecialItem[];
  locale: ProductLocale;
  dispatching: boolean;
  onSendXping(orderId: string): void;
}) {
  const paid = items.filter(
    (item) => item.state === "paid" && item.sku === "0x1_special_1m",
  );
  if (!paid.length) return null;
  const t = copy[locale];
  return (
    <section className="special-pickup" aria-label={t.title}>
      {paid.map((item) => (
        <article className="special-pickup__item" key={item.order_id}>
          <strong>{t.title}</strong>
          <p>{t.message}</p>
          <button
            type="button"
            disabled={dispatching}
            onClick={() => onSendXping(item.order_id)}
          >
            {t.action}
          </button>
          {dispatching && <small role="status">{t.pending}</small>}
        </article>
      ))}
    </section>
  );
}
