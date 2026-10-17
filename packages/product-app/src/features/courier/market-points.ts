// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CourierDirectoryPort,
  CourierPlan,
  CourierRequest,
} from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapPinnedLandmark,
} from "@nilx-one/map-contract";
import type { ProductLocale } from "../../shell/localization";
import { courierCoordinate, courierPoint } from "./courier-map";

export const MARKET_BUSINESS_ID = "0xda-market";
export const MARKET_MARKER_ONLY_OWNERS = [MARKET_BUSINESS_ID] as const;

export interface MarketPoint {
  readonly id: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly uk: string;
  readonly en: string;
  readonly ru: string;
}

/** Author-seeded game destinations. Sources and approximate placements: docs/market-points.md. */
export const KYIV_MARKET_POINTS: readonly MarketPoint[] = [
  {
    id: "zoloti-vorota",
    longitude: 30.5131,
    latitude: 50.4489,
    uk: "Золоті Ворота",
    en: "Golden Gate",
    ru: "Золотые Ворота",
  },
  {
    id: "batkivshchyna",
    longitude: 30.5632,
    latitude: 50.4265,
    uk: "Батьківщина-Мати",
    en: "Motherland Monument",
    ru: "Родина-мать",
  },
  {
    id: "peizazhna-aleia",
    longitude: 30.51562,
    latitude: 50.45642,
    uk: "Пейзажна алея",
    en: "Landscape Alley",
    ru: "Пейзажная аллея",
  },
  {
    id: "cosmopolite",
    longitude: 30.44237,
    latitude: 50.4506,
    uk: "Космополіт · Шулявка",
    en: "Cosmopolite · Shuliavka",
    ru: "Космополит · Шулявка",
  },
  {
    id: "gorodok-gallery",
    longitude: 30.49582,
    latitude: 50.48974,
    uk: "Gorodok Gallery",
    en: "Gorodok Gallery",
    ru: "Gorodok Gallery",
  },
  {
    id: "smart-plaza-polytech",
    longitude: 30.46827,
    latitude: 50.45135,
    uk: "SmartPlaza Polytech",
    en: "SmartPlaza Polytech",
    ru: "SmartPlaza Polytech",
  },
  {
    id: "raion",
    longitude: 30.60187,
    latitude: 50.51648,
    uk: "РайON · Троєщина",
    en: "RAION · Troieshchyna",
    ru: "РайON · Троещина",
  },
  {
    id: "mandarin-plaza",
    longitude: 30.52153,
    latitude: 50.44137,
    uk: "Mandarin Plaza",
    en: "Mandarin Plaza",
    ru: "Mandarin Plaza",
  },
  {
    id: "respublika-park",
    longitude: 30.44626,
    latitude: 50.37355,
    uk: "Respublika Park",
    en: "Respublika Park",
    ru: "Respublika Park",
  },
  {
    id: "lavina-mall",
    longitude: 30.36049,
    latitude: 50.49555,
    uk: "Lavina Mall",
    en: "Lavina Mall",
    ru: "Lavina Mall",
  },
  {
    id: "river-mall",
    longitude: 30.61195,
    latitude: 50.40531,
    uk: "River Mall",
    en: "River Mall",
    ru: "River Mall",
  },
  {
    id: "retroville",
    longitude: 30.41658,
    latitude: 50.50359,
    uk: "Retroville",
    en: "Retroville",
    ru: "Retroville",
  },
  {
    id: "tsum",
    longitude: 30.52047,
    latitude: 50.44546,
    uk: "ЦУМ 🤍",
    en: "TSUM 🤍",
    ru: "ЦУМ 🤍",
  },
  {
    id: "skymall",
    longitude: 30.55936,
    latitude: 50.49304,
    uk: "SkyMall",
    en: "SkyMall",
    ru: "SkyMall",
  },
  {
    id: "dream-berry",
    longitude: 30.49865,
    latitude: 50.51681,
    uk: "DREAM berry",
    en: "DREAM berry",
    ru: "DREAM berry",
  },
  {
    id: "dream-yellow",
    longitude: 30.49837,
    latitude: 50.50753,
    uk: "DREAM yellow",
    en: "DREAM yellow",
    ru: "DREAM yellow",
  },
  {
    id: "gulliver",
    longitude: 30.52312,
    latitude: 50.43869,
    uk: "Gulliver 🖤",
    en: "Gulliver 🖤",
    ru: "Gulliver 🖤",
  },
  {
    id: "osokorky",
    longitude: 30.61625,
    latitude: 50.39519,
    uk: "метро Осокорки",
    en: "Osokorky metro",
    ru: "метро Осокорки",
  },
  {
    id: "pozniaky",
    longitude: 30.63466,
    latitude: 50.3979,
    uk: "метро Позняки",
    en: "Pozniaky metro",
    ru: "метро Позняки",
  },
  {
    id: "troieshchyna-centre",
    longitude: 30.62306,
    latitude: 50.52167,
    uk: "Троєщина · Молодіжний парк",
    en: "Troieshchyna · Molodizhnyi Park",
    ru: "Троещина · Молодёжный парк",
  },
  {
    id: "livoberezhna",
    longitude: 30.59817,
    latitude: 50.45186,
    uk: "метро Лівобережна",
    en: "Livoberezhna metro",
    ru: "метро Левобережная",
  },
  {
    id: "petra-zaporozhtsia",
    longitude: 30.59755,
    latitude: 50.47938,
    uk: "вул. Чорних Запорожців",
    en: "Chornykh Zaporozhtsiv Street",
    ru: "ул. Чёрных Запорожцев",
  },
];

export const marketPointId = (point: MarketPoint) =>
  `${MARKET_BUSINESS_ID}-${point.id}`;

export function marketMapPoints(
  locale: ProductLocale,
  detail: string,
): MapPinnedLandmark[] {
  return KYIV_MARKET_POINTS.map((point) => ({
    id: `market:${marketPointId(point)}`,
    longitude: point.longitude,
    latitude: point.latitude,
    kind: "business",
    weight: 0.8,
    title: `0xda-market ${locale === "uk-UA" ? point.uk : locale === "ru-RU" ? point.ru : point.en}`,
    detail,
  }));
}

const destinations = KYIV_MARKET_POINTS.map((point) => ({
  business_id: MARKET_BUSINESS_ID,
  point_id: marketPointId(point),
  coordinate: courierCoordinate(point),
}));

/** A local game map, never an authenticated shop/ownership projection. */
export const seededMarketDirectory: CourierDirectoryPort = {
  async destinations() {
    return { business_id: MARKET_BUSINESS_ID, destinations };
  },
  previewPlan(request) {
    return seededMarketPlan(request);
  },
};

/** Presentation fallback for these exact author-seeded pins on an older runtime. */
export function seededMarketPlan(request: CourierRequest): CourierPlan {
  const origin = courierPoint(request.origin);
  if (
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(origin.latitude) ||
    Math.abs(origin.longitude) > 180 ||
    Math.abs(origin.latitude) > 90 ||
    request.business_id !== MARKET_BUSINESS_ID
  )
    throw new Error("Invalid map preview");
  const ranked = destinations
    .map((destination) => ({
      destination,
      distance: Math.ceil(
        mapDistanceMeters(origin, courierPoint(destination.coordinate)),
      ),
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.destination.point_id.localeCompare(b.destination.point_id),
    );
  const nearest = ranked[0]!;
  // The flyover publishes the actual road-route ETA and arrival event.
  return {
    tier: request.tier,
    origin: request.origin,
    destination: nearest.destination,
    started_at_ms: request.started_at_ms,
    arrives_at_ms: request.started_at_ms,
    distance_m: String(nearest.distance),
  };
}
