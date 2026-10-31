// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { useEffect, useState } from "react";
import { createBrowserGeolocation } from "@nilx-one/host-browser";
import { createBusinessSurfaceHttp } from "@nilx-one/identity-http";
import { createMapLibreRenderer } from "@nilx-one/map-maplibre";
import {
  BusinessWorld,
  MarketDock,
  seededMarketDirectory,
  marketPointTitle,
  marketMapPoints,
  type EmbeddedMarketOrder,
} from "@nilx-one/product-app/business";
import { useLocalization } from "@nilx-one/product-app/localization";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import { createBusinessNavigation } from "../business-navigation";
import {
  createMarketCheckout,
  createNilxOneMarketCatalog,
  marketReturnUrl,
} from "@nilx-one/market-host";
import {
  readMarketPointAddresses,
  resolveMarketPointPath,
  type MarketPointAddress,
} from "./point-addresses";

const STATION_PREFIX = "0xda-market-";

// Kyiv currently has only author-seeded, unverified points. Other city choices
// are discovery placeholders, never fabricated Market inventory.
const cities = [
  { id: "kyiv", uk: "Київ", en: "Kyiv" },
  { id: "odesa", uk: "Одеса", en: "Odesa" },
  { id: "paris", uk: "Париж", en: "Paris" },
  { id: "minsk", uk: "Мінськ", en: "Minsk" },
  { id: "petersburg", uk: "Петербург", en: "Saint Petersburg" },
] as const;

interface Visit {
  point: string;
  seeds: string;
  seeds_authority: "client_display" | "identity_snapshot";
  avaia: { longitude: number; latitude: number };
  /** Present only for a visit Identity can settle a purchase for. */
  visit_id?: string;
  return_path?: string;
}

export function MarketLanding() {
  const { resolved } = useLocalization();
  const uk = resolved === "uk-UA";
  const [dependencies] = useState(() => ({
    renderer: createMapLibreRenderer(),
    directory: createBusinessSurfaceHttp(),
    navigation: createBusinessNavigation("0xda-market"),
    geolocation: createBrowserGeolocation(),
    catalog: createNilxOneMarketCatalog(),
    checkout: createMarketCheckout(),
  }));
  const [visit, setVisit] = useState<Visit>();
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [points, setPoints] = useState<
    Awaited<ReturnType<typeof seededMarketDirectory.points>>["points"]
  >([]);
  const [cityQuery, setCityQuery] = useState("Київ");
  const [pointQuery, setPointQuery] = useState("");
  const [path, setPath] = useState(() => location.pathname);
  // Market's registry of point addresses; empty when it cannot be read.
  const [addresses, setAddresses] = useState<readonly MarketPointAddress[]>();
  // The station an older or unlisted path segment resolved to, if any.
  const [lookup, setLookup] = useState<{ segment: string; station?: string }>();

  useEffect(() => {
    let live = true;
    void readMarketPointAddresses().then(
      (registry) => {
        if (live) setAddresses(registry);
      },
      () => {
        // Without the registry a path still names a station by its place.
        if (live) setAddresses([]);
      },
    );
    // Guest browsing must work even without a successful 0x1 handoff.
    void seededMarketDirectory.points().then(
      (projection) => {
        if (live) setPoints(projection.points);
      },
      () => {
        if (live) setDirectoryFailed(true);
      },
    );
    void fetch("/nilx-browser/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const context = (await response.json()) as Partial<Visit>;
        if (
          typeof context.point !== "string" ||
          typeof context.seeds !== "string" ||
          !/^(?:0|[1-9][0-9]{0,19})$/.test(context.seeds) ||
          (context.seeds_authority !== "client_display" &&
            context.seeds_authority !== "identity_snapshot") ||
          !context.avaia ||
          !Number.isFinite(context.avaia.longitude) ||
          !Number.isFinite(context.avaia.latitude) ||
          Math.abs(context.avaia.longitude) > 180 ||
          Math.abs(context.avaia.latitude) > 90
        ) {
          return;
        }
        // A purchase needs the whole Identity binding, never part of it.
        const { visit_id, return_path, ...view } = context as Visit;
        const purchase =
          typeof visit_id === "string" &&
          /^[\w-]{43}$/.test(visit_id) &&
          typeof return_path === "string"
            ? { visit_id, return_path }
            : {};
        if (live) setVisit({ ...view, ...purchase });
      })
      .catch(() => {
        // Missing/expired sessions never block the public directory.
      });
    const pop = () => setPath(location.pathname);
    window.addEventListener("popstate", pop);
    return () => {
      live = false;
      window.removeEventListener("popstate", pop);
    };
  }, []);

  const navigate = (slug?: string) => {
    const next = slug ? `/${encodeURIComponent(slug)}` : "/";
    history.pushState(null, "", next);
    setPath(next);
  };
  let slug = "!invalid";
  try {
    slug = decodeURIComponent(path.slice(1)).replace(/\/$/, "");
  } catch {
    // Malformed paths never resolve to an arbitrary point.
  }
  const listed = addresses?.find((entry) => entry.address === slug);
  const looked = lookup?.segment === slug ? lookup : undefined;
  const station = listed?.station ?? looked?.station ?? STATION_PREFIX + slug;
  const selected = slug
    ? points.find((point) => point.pub_dress === station)
    : undefined;
  const resolving =
    slug !== "" && !listed && (addresses === undefined || !looked);
  const addressOf = (pubDress: string) =>
    addresses?.find((entry) => entry.station === pubDress)?.address ??
    pubDress.slice(STATION_PREFIX.length);

  // An older link (e.g. /zoloti-vorota or /золоті) or an unlisted segment is
  // asked of Market once; a non-canonical one is replaced by its address.
  useEffect(() => {
    if (!slug || addresses === undefined || listed || looked) return;
    let live = true;
    void resolveMarketPointPath(slug).then(
      (resolution) => {
        if (!live) return;
        setLookup(
          resolution
            ? { segment: slug, station: resolution.station }
            : { segment: slug },
        );
        if (resolution && !resolution.canonical) {
          const next = `/${resolution.address}`;
          history.replaceState(history.state, "", next);
          setPath(next);
        }
      },
      () => {
        if (live) setLookup({ segment: slug });
      },
    );
    return () => {
      live = false;
    };
  }, [slug, addresses, listed, looked]);

  useEffect(() => {
    const renderer = dependencies.renderer;
    renderer.setPinnedLandmarks?.(marketMapPoints(resolved, "0xda-market"));
    const focus = () => {
      if (selected && renderer.getStatus().kind === "ready")
        renderer.setCamera(
          {
            center: [
              Number(selected.coordinate.longitude_e7) / 1e7,
              Number(selected.coordinate.latitude_e7) / 1e7,
            ],
            zoom: 17,
            bearing: 0,
            pitch: 45,
          },
          { motion: "immediate" },
        );
    };
    focus();
    return renderer.subscribe(focus);
  }, [dependencies.renderer, selected, resolved]);

  const visitedPoint =
    visit &&
    points.find((point) => point.pub_dress === `0xda-market-${visit.point}`);
  const ordered = [...points].sort((a, b) => {
    // Client-selected point is not proof of physical arrival.
    if (visitedPoint && a.id.number === visitedPoint.id.number) return -1;
    if (visitedPoint && b.id.number === visitedPoint.id.number) return 1;
    if (!visit) return a.id.number - b.id.number;
    const distance = (point: typeof a) =>
      mapDistanceMeters(visit.avaia, {
        longitude: Number(point.coordinate.longitude_e7) / 1e7,
        latitude: Number(point.coordinate.latitude_e7) / 1e7,
      });
    return distance(a) - distance(b) || a.id.number - b.id.number;
  });
  const cityNeedle = cityQuery.trim().toLocaleLowerCase();
  const city = cities.find(
    (candidate) =>
      candidate.uk.toLocaleLowerCase() === cityNeedle ||
      candidate.en.toLocaleLowerCase() === cityNeedle,
  );
  const shownPoints =
    city?.id === "kyiv"
      ? ordered.filter((point) =>
          marketPointTitle(point, resolved)
            .toLocaleLowerCase()
            .includes(pointQuery.trim().toLocaleLowerCase()),
        )
      : [];

  const pinnedLabel = uk ? "Точка переходу" : "Selected visit point";
  const purchaseVisit = visit?.visit_id;

  const content = (
    <section className="market-dock">
      {directoryFailed ? (
        <p role="alert">
          {uk
            ? "Список точок тимчасово недоступний."
            : "Point directory temporarily unavailable."}
        </p>
      ) : (
        <>
          {visit && (
            <p>
              {visit.seeds} seeds ·{" "}
              {visit.seeds_authority === "identity_snapshot"
                ? uk
                  ? "баланс на момент переходу; перед покупкою буде перевірено знову"
                  : "balance at handoff; checked again before purchase"
                : uk
                  ? "дані пристрою, не підтверджений баланс"
                  : "device display only, not a verified balance"}
            </p>
          )}
          {selected ? (
            <MarketDock
              catalog={dependencies.catalog}
              plan={{
                destination: selected,
                origin: selected.coordinate,
                started_at_ms: "0",
              }}
              {...(purchaseVisit === undefined
                ? {}
                : {
                    checkout: dependencies.checkout,
                    onPurchased: (order: EmbeddedMarketOrder) =>
                      location.assign(
                        marketReturnUrl({
                          returnPath: visit?.return_path ?? "/",
                          visitId: order.visitId ?? purchaseVisit,
                          orderId: order.id,
                        }),
                      ),
                  })}
              onClose={() => navigate()}
            />
          ) : slug && (resolving || points.length === 0) ? (
            <p role="status">{uk ? "Шукаємо точку…" : "Finding the point…"}</p>
          ) : slug ? (
            <>
              <p>{uk ? "Точку не знайдено" : "Point not found"}</p>
              <button type="button" onClick={() => navigate()}>
                0xda-market
              </button>
            </>
          ) : (
            <>
              <h2>0xda-market</h2>
              <label htmlFor="market-city">
                {uk ? "Усі точки в місті" : "Browse points in city"}
              </label>
              <input
                id="market-city"
                list="market-cities"
                value={cityQuery}
                onChange={(event) => setCityQuery(event.target.value)}
                placeholder={uk ? "Пошук міста" : "Search cities"}
              />
              <datalist id="market-cities">
                {cities.map((option) => (
                  <option key={option.id} value={uk ? option.uk : option.en} />
                ))}
              </datalist>
              <label htmlFor="market-point-search">
                {uk ? "Пошук точки" : "Search points"}
              </label>
              <input
                id="market-point-search"
                type="search"
                value={pointQuery}
                onChange={(event) => setPointQuery(event.target.value)}
              />
              {visitedPoint && city?.id === "kyiv" && (
                <p>
                  {uk
                    ? "Закріплено точку переходу з 0x1. Координати Avaia надані клієнтом, а не перевірені сервером."
                    : "Pinned point selected in 0x1. Avaia coordinates are client-provided, not server-verified."}
                </p>
              )}
              {shownPoints.length === 0 ? (
                <p role="status">
                  {uk
                    ? "У цьому місті поки немає доступних точок."
                    : "No available points in this city yet."}
                </p>
              ) : (
                <ol>
                  {shownPoints.map((point) => (
                    <li key={point.id.number}>
                      <button
                        type="button"
                        onClick={() => navigate(addressOf(point.pub_dress))}
                      >
                        {marketPointTitle(point, resolved)}
                      </button>
                      {visitedPoint?.id.number === point.id.number && (
                        <span> · {pinnedLabel}</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
  return <BusinessWorld {...dependencies} content={content} />;
}
