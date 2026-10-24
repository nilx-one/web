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
  const [failed, setFailed] = useState(false);
  const [points, setPoints] = useState<
    Awaited<ReturnType<typeof seededMarketDirectory.points>>["points"]
  >([]);
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch("/nilx-browser/session", {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      }).then(async (r) => {
        if (!r.ok) throw new Error("Session required");
        return (await r.json()) as Visit;
      }),
      seededMarketDirectory.points(),
    ]).then(
      ([context, projection]) => {
        if (live) {
          setVisit(context);
          setPoints(projection.points);
        }
      },
      () => {
        if (live) setFailed(true);
      },
    );
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
  const ordered = visit
    ? [...points].sort((a, b) => {
        const key = (p: typeof a) => p.pub_dress.slice("0xda-market-".length);
        if (key(a) === visit.point) return -1;
        if (key(b) === visit.point) return 1;
        const distance = (p: typeof a) =>
          mapDistanceMeters(visit.avaia, {
            longitude: Number(p.coordinate.longitude_e7) / 1e7,
            latitude: Number(p.coordinate.latitude_e7) / 1e7,
          });
        return distance(a) - distance(b) || a.id.number - b.id.number;
      })
    : [];
  const content = (
    <section className="market-dock">
      {failed ? (
        <p role="alert">
          {uk
            ? "Сесію маркету не вдалося відкрити. Поверніться до 0x1 і повторіть перехід."
            : "Market session unavailable. Return to 0x1 and retry."}{" "}
          <a href="https://nilx.one/">0x1</a>
        </p>
      ) : !visit ? (
        <p role="status">{uk ? "Відкриваємо маркет…" : "Opening Market…"}</p>
      ) : (
        <>
          <p>
            {visit.seeds} seeds · {uk ? "баланс пристрою" : "device balance"}
          </p>
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
              <button onClick={() => navigate()}>0xda-market</button>
            </>
          ) : (
            <>
              <h2>0xda-market</h2>
              <ol>
                {ordered.map((point) => (
                  <li key={point.id.number}>
                    <button
                      onClick={() =>
                        navigate(point.pub_dress.slice("0xda-market-".length))
                      }
                    >
                      {marketPointTitle(point, resolved)}
                    </button>
                    {point.pub_dress === `0xda-market-${visit.point}` && (
                      <span> · {uk ? "Ви тут" : "You are here"}</span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
  return <BusinessWorld {...dependencies} content={content} />;
}
