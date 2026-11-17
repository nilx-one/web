// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { BusinessPoint } from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import type { ProductLocale } from "../../shell/localization";
import { courierPoint } from "./courier-map";
import type { PaidSpecialItem } from "./market-dock";
import { marketPointTitle } from "./market-points";
import "./manual-market-pickup.css";

/**
 * A visual hint based on the in-game body's current position, not a verified
 * Market visit or physical geolocation proof. The server independently checks
 * the owner, active session, paid item and one-time collection visit.
 */
export const MANUAL_MARKET_PICKUP_HINT_METERS = 15;

export function nearbyMarketPickupPoint(
  position: MapPointSelection | undefined,
  points: readonly BusinessPoint[],
): BusinessPoint | undefined {
  if (
    !position ||
    !Number.isFinite(position.longitude) ||
    !Number.isFinite(position.latitude)
  )
    return undefined;
  return points
    .map((point) => ({
      point,
      distance: mapDistanceMeters(position, courierPoint(point.coordinate)),
    }))
    .filter(({ distance }) => distance <= MANUAL_MARKET_PICKUP_HINT_METERS)
    .sort(
      (a, b) =>
        a.distance - b.distance || a.point.id.number - b.point.id.number,
    )[0]?.point;
}

const copy = {
  "uk-UA": {
    title: "Special чекає в магазині",
    action: "Забрати Special",
    busy: "Відкриваємо 0xda-market…",
    error: "Не вдалося відкрити магазин. Спробуй ще раз.",
  },
  "ru-RU": {
    title: "Special ждёт в магазине",
    action: "Забрать Special",
    busy: "Открываем 0xda-market…",
    error: "Не удалось открыть магазин. Попробуй ещё раз.",
  },
  en: {
    title: "Special ready at this shop",
    action: "Collect Special",
    busy: "Opening 0xda-market…",
    error: "Unable to open Market. Try again.",
  },
} as const;

/** A user action at a nearby in-world Market point, never automatic pickup. */
export function ManualMarketPickup({
  items,
  position,
  points,
  locale,
  disabled,
  busy,
  failed,
  onVisit,
}: {
  items: readonly PaidSpecialItem[];
  position: MapPointSelection | undefined;
  points: readonly BusinessPoint[];
  locale: ProductLocale;
  disabled: boolean;
  busy: boolean;
  failed: boolean;
  onVisit(orderId: string, point: BusinessPoint): void;
}) {
  const item = items.find(
    (entry) => entry.state === "paid" && entry.sku === "0x1_special_1m",
  );
  const point = nearbyMarketPickupPoint(position, points);
  if (!item || !point) return null;
  const t = copy[locale];
  return (
    <section className="manual-market-pickup" aria-label={t.title}>
      <strong>{t.title}</strong>
      <p>{marketPointTitle(point, locale)}</p>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => onVisit(item.order_id, point)}
      >
        {t.action}
      </button>
      {busy && <small role="status">{t.busy}</small>}
      {failed && <p role="alert">{t.error}</p>}
    </section>
  );
}
