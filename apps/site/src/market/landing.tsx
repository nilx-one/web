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
} from "@nilx-one/product-app/business";
import { useLocalization } from "@nilx-one/product-app/localization";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import { createBusinessNavigation } from "../business-navigation";
import { createNilxOneMarketCatalog } from "./catalog";

/** Only Kyiv has author-seeded, unverified points at present. Other cities are
 * choices for discovery, not fabricated business listings. */
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
  seeds_authority: "client_display";
  avaia: { longitude: number; latitude: number };
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
  }));
  const [visit, setVisit] = useState<Visit>();
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const [points, setPoints] = useState<
    Awaited<ReturnType<typeof seededMarketDirectory.points>>["points"]
  >([]);
  const [cityQuery, setCityQuery] = useState("Київ");
  const [pointQuery, setPointQuery] = useState("");
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    let live = true;
    // Public browsing is independent of a 0x1 handoff. An absent/expired
    // session only removes visitor-specific context; it never blocks the list.
    void seededMarketDirectory.points().then(
      (projection) => { if (live) setPoints(projection.points); },
      () => { if (live) setDirectoryFailed(true); },
    );
    void fetch("/nilx-browser/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }).then(async (response) => {
      if (!response.ok) return;
      const context = (await response.json()) as Partial<Visit>;
      if (
        typeof context.point !== "string" ||
        typeof context.seeds !== "string" ||
        context.seeds_authority !== "client_display" ||
        !context.avaia ||
        !Number.isFinite(context.avaia.longitude) ||
        !Number.isFinite(context.avaia.latitude)
      ) return;
      if (live) setVisit(context as Visit);
    }).catch(() => {
      // A guest, an expired handoff, and a network error all preserve
      // public Market browsing without pretending to have an active visit.
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
    /* invalid route */
  }
  const selected = points.find(
    (p) =>
      p.pub_dress ===
      `0xda-market-${slug === "золоті" ? "zoloti-vorota" : slug}`,
  );
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
  const visitedPoint = visit &&
    points.find((point) => point.pub_dress === `0xda-market-${visit.point}`);
  const ordered = [...points].sort((a, b) => {
    // This is only the 0x1 client's selected visit, NOT verified geolocation.
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
  const city = cities.find(
    (candidate) =>
      candidate.uk.toLocaleLowerCase() === cityQuery.trim().toLocaleLowerCase() ||
      candidate.en.toLocaleLowerCase() === cityQuery.trim().toLocaleLowerCase(),
  );
  const shownPoints = city?.id === "kyiv"
    ? ordered.filter((point) => marketPointTitle(point, resolved)
        .toLocaleLowerCase().includes(pointQuery.trim().toLocaleLowerCase()))
    : [];
  const content = (
    <section className="market-dock">
      {directoryFailed ? (
        <p role="alert">
          {uk ? "Список точок тимчасово недоступний." : "Point directory temporarily unavailable."}
        </p>
      ) : (
        <>
          {visit && (
            <p>
              {visit.seeds} seeds · {uk ? "дані пристрою, не підтверджений баланс" : "device display only, not a verified balance"}
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
              onClose={() => navigate()}
            />
          ) : slug ? (
            <>
              <p>{uk ? "Точку не знайдено" : "Point not found"}</p>
              <button type="button" onClick={() => navigate()}>0xda-market</button>
            </>
          ) : (
            <>
              <h2>0xda-market</h2>
              <label htmlFor="market-city">{uk ? "Усі точки в місті" : "Browse points in city"}</label>
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
              <label htmlFor="market-point-search">{uk ? "Пошук точки" : "Search points"}</label>
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
                  {uk ? "У цьому місті поки немає доступних точок." : "No available points in this city yet."}
                </p>
              ) : (
                <ol>
                  {shownPoints.map((point) => (
                    <li key={point.id.number}>
                      <button
                        type="button"
                        onClick={() => navigate(point.pub_dress.slice("0xda-market-".length))}
                      >
                        {marketPointTitle(point, resolved)}
                      </button>
                      {visitedPoint?.id.number === point.id.number && (
                        <span> · {uk ? "Точка переходу" : "Selected visit point"}</span>
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
