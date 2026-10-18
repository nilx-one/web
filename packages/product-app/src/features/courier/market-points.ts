// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BusinessPoint,
  BusinessPointProjection,
  CourierCoordinate,
  CourierDirectoryPort,
} from "@nilx-one/application";
import {
  mapDistanceMeters,
  type MapPinnedLandmark,
} from "@nilx-one/map-contract";
import type { ProductLocale } from "../../shell/localization";
import { courierCoordinate, courierPoint } from "./courier-map";

/** The owning 0xda-market BBond's `pub_dress`. */
export const MARKET_OWNER_PUB_DRESS = "0xda-market";
export const MARKET_MARKER_ONLY_OWNERS = [MARKET_OWNER_PUB_DRESS] as const;

export interface MarketPoint {
  /** The place component of the seeded point `pub_dress`. */
  readonly id: string;
  /** The point's `UInt8` number: allocated once, never reassigned. */
  readonly number: number;
  readonly longitude: number;
  readonly latitude: number;
  readonly uk: string;
  readonly en: string;
  readonly ru: string;
}

/**
 * Author-seeded, unverified BusinessPoints of 0xda-market for local preview.
 * Sources and approximate placements: docs/market-points.md.
 */
export const KYIV_MARKET_POINTS: readonly MarketPoint[] = [
  {
    id: "zoloti-vorota",
    number: 0,
    longitude: 30.5131,
    latitude: 50.4489,
    uk: "Золоті Ворота",
    en: "Golden Gate",
    ru: "Золотые Ворота",
  },
  {
    id: "batkivshchyna",
    number: 1,
    longitude: 30.5632,
    latitude: 50.4265,
    uk: "Батьківщина-Мати",
    en: "Motherland Monument",
    ru: "Родина-мать",
  },
  {
    id: "peizazhna-aleia",
    number: 2,
    longitude: 30.51562,
    latitude: 50.45642,
    uk: "Пейзажна алея",
    en: "Landscape Alley",
    ru: "Пейзажная аллея",
  },
  {
    id: "cosmopolite",
    number: 3,
    longitude: 30.44237,
    latitude: 50.4506,
    uk: "Космополіт · Шулявка",
    en: "Cosmopolite · Shuliavka",
    ru: "Космополит · Шулявка",
  },
  {
    id: "gorodok-gallery",
    number: 4,
    longitude: 30.49582,
    latitude: 50.48974,
    uk: "Gorodok Gallery",
    en: "Gorodok Gallery",
    ru: "Gorodok Gallery",
  },
  {
    id: "smart-plaza-polytech",
    number: 5,
    longitude: 30.46827,
    latitude: 50.45135,
    uk: "SmartPlaza Polytech",
    en: "SmartPlaza Polytech",
    ru: "SmartPlaza Polytech",
  },
  {
    id: "raion",
    number: 6,
    longitude: 30.60187,
    latitude: 50.51648,
    uk: "РайON · Троєщина",
    en: "RAION · Troieshchyna",
    ru: "РайON · Троещина",
  },
  {
    id: "mandarin-plaza",
    number: 7,
    longitude: 30.52153,
    latitude: 50.44137,
    uk: "Mandarin Plaza",
    en: "Mandarin Plaza",
    ru: "Mandarin Plaza",
  },
  {
    id: "respublika-park",
    number: 8,
    longitude: 30.44626,
    latitude: 50.37355,
    uk: "Respublika Park",
    en: "Respublika Park",
    ru: "Respublika Park",
  },
  {
    id: "lavina-mall",
    number: 9,
    longitude: 30.36049,
    latitude: 50.49555,
    uk: "Lavina Mall",
    en: "Lavina Mall",
    ru: "Lavina Mall",
  },
  {
    id: "river-mall",
    number: 10,
    longitude: 30.61195,
    latitude: 50.40531,
    uk: "River Mall",
    en: "River Mall",
    ru: "River Mall",
  },
  {
    id: "retroville",
    number: 11,
    longitude: 30.41658,
    latitude: 50.50359,
    uk: "Retroville",
    en: "Retroville",
    ru: "Retroville",
  },
  {
    id: "tsum",
    number: 12,
    longitude: 30.52047,
    latitude: 50.44546,
    uk: "ЦУМ 🤍",
    en: "TSUM 🤍",
    ru: "ЦУМ 🤍",
  },
  {
    id: "skymall",
    number: 13,
    longitude: 30.55936,
    latitude: 50.49304,
    uk: "SkyMall",
    en: "SkyMall",
    ru: "SkyMall",
  },
  {
    id: "dream-berry",
    number: 14,
    longitude: 30.49865,
    latitude: 50.51681,
    uk: "DREAM berry",
    en: "DREAM berry",
    ru: "DREAM berry",
  },
  {
    id: "dream-yellow",
    number: 15,
    longitude: 30.49837,
    latitude: 50.50753,
    uk: "DREAM yellow",
    en: "DREAM yellow",
    ru: "DREAM yellow",
  },
  {
    id: "gulliver",
    number: 16,
    longitude: 30.52312,
    latitude: 50.43869,
    uk: "Gulliver 🖤",
    en: "Gulliver 🖤",
    ru: "Gulliver 🖤",
  },
  {
    id: "osokorky",
    number: 17,
    longitude: 30.61625,
    latitude: 50.39519,
    uk: "метро Осокорки",
    en: "Osokorky metro",
    ru: "метро Осокорки",
  },
  {
    id: "pozniaky",
    number: 18,
    longitude: 30.63466,
    latitude: 50.3979,
    uk: "метро Позняки",
    en: "Pozniaky metro",
    ru: "метро Позняки",
  },
  {
    id: "troieshchyna-centre",
    number: 19,
    longitude: 30.62306,
    latitude: 50.52167,
    uk: "Троєщина · Молодіжний парк",
    en: "Troieshchyna · Molodizhnyi Park",
    ru: "Троещина · Молодёжный парк",
  },
  {
    id: "livoberezhna",
    number: 20,
    longitude: 30.59817,
    latitude: 50.45186,
    uk: "метро Лівобережна",
    en: "Livoberezhna metro",
    ru: "метро Левобережная",
  },
  {
    id: "petra-zaporozhtsia",
    number: 21,
    longitude: 30.59755,
    latitude: 50.47938,
    uk: "вул. Чорних Запорожців",
    en: "Chornykh Zaporozhtsiv Street",
    ru: "ул. Чёрных Запорожцев",
  },
];

/**
 * The seeded point `pub_dress`, `<owner>-<place>`. It is an author-seeded
 * constant: Web derives no point address until Core defines that contract.
 * It is also the reference these pins used before the BusinessPoint model.
 */
export const marketPointPubDress = (point: MarketPoint) =>
  `${MARKET_OWNER_PUB_DRESS}-${point.id}`;

const description = (point: MarketPoint) => point.en;

export const KYIV_MARKET_BUSINESS_POINTS: readonly BusinessPoint[] =
  KYIV_MARKET_POINTS.map((point) => ({
    id: { owner_pub_dress: MARKET_OWNER_PUB_DRESS, number: point.number },
    pub_dress: marketPointPubDress(point),
    description: description(point),
    isVerified: false,
    coordinate: courierCoordinate(point),
  }));

/**
 * Explicit compatibility mapping from the pre-BusinessPoint reference
 * (`0xda-market-<place>`) to the stable point ID. Nothing persisted the old
 * reference; the mapping is kept so any that surfaces resolves, not guessed.
 */
export const LEGACY_MARKET_POINT_NUMBERS: ReadonlyMap<string, number> = new Map(
  KYIV_MARKET_POINTS.map((point) => [marketPointPubDress(point), point.number]),
);

/** One map pin per BusinessPoint, keyed by its stable ID. */
export const marketPinId = (point: BusinessPoint) =>
  `business-point:${point.id.owner_pub_dress}:${point.id.number}`;

/** What a seeded BusinessPoint is called on the map, in the viewer's locale. */
export function marketPointTitle(
  point: BusinessPoint,
  locale: ProductLocale,
): string {
  const seeded = KYIV_MARKET_POINTS.find(
    (entry) =>
      point.id.owner_pub_dress === MARKET_OWNER_PUB_DRESS &&
      entry.number === point.id.number,
  );
  const name =
    seeded === undefined
      ? point.description
      : locale === "uk-UA"
        ? seeded.uk
        : locale === "ru-RU"
          ? seeded.ru
          : seeded.en;
  return `0xda-market ${name}`;
}

export function marketMapPoints(
  locale: ProductLocale,
  detail: string,
): MapPinnedLandmark[] {
  return KYIV_MARKET_POINTS.map((point, index) => ({
    id: marketPinId(KYIV_MARKET_BUSINESS_POINTS[index]!),
    longitude: point.longitude,
    latitude: point.latitude,
    kind: "business",
    weight: 0.8,
    title: marketPointTitle(KYIV_MARKET_BUSINESS_POINTS[index]!, locale),
    detail,
  }));
}

const projection: BusinessPointProjection = {
  owner_pub_dress: MARKET_OWNER_PUB_DRESS,
  points: KYIV_MARKET_BUSINESS_POINTS,
};

/** A local preview of unverified points, never an authenticated projection. */
export const seededMarketDirectory: CourierDirectoryPort = {
  async points() {
    return projection;
  },
  previewDestination(origin, requested) {
    if (requested !== projection) throw new Error("Not the seeded preview");
    return seededMarketDestination(origin);
  },
};

/**
 * Presentation fallback over these exact seeded points on a runtime without
 * `courier_destination`: nearest first, then the smallest point number, as
 * Core decides.
 */
export function seededMarketDestination(
  origin: CourierCoordinate,
): BusinessPoint {
  const from = courierPoint(origin);
  if (
    !Number.isFinite(from.longitude) ||
    !Number.isFinite(from.latitude) ||
    Math.abs(from.longitude) > 180 ||
    Math.abs(from.latitude) > 90
  )
    throw new Error("Invalid map preview");
  return KYIV_MARKET_BUSINESS_POINTS.map((point) => ({
    point,
    distance: mapDistanceMeters(from, courierPoint(point.coordinate)),
  })).sort(
    (a, b) => a.distance - b.distance || a.point.id.number - b.point.id.number,
  )[0]!.point;
}
