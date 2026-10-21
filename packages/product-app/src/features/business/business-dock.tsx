// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BusinessContact,
  BusinessNavigationPort,
  BusinessSurfacePort,
  BusinessSurfaceResult,
} from "@nilx-one/application";
import type {
  GeolocationCapability,
  ObservedGeolocation,
} from "@nilx-one/host-contract";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DockWindow } from "../../shell/dock-window";
import { useLocalization } from "../../shell/localization";
import { businessMessages } from "./business-messages";
import {
  cityForObservation,
  safeBusinessContact,
  searchBusinessCities,
} from "./business-view-model";
import "./business.css";

export interface BusinessDockProps {
  readonly directory: BusinessSurfacePort;
  readonly navigation: BusinessNavigationPort;
  readonly geolocation: GeolocationCapability;
  readonly observation?: ObservedGeolocation;
}

function Contacts({
  contacts,
  title,
}: {
  contacts: readonly BusinessContact[];
  title: string;
}) {
  const visible = contacts.flatMap((contact) => {
    const href = safeBusinessContact(contact.href);
    return href === undefined ? [] : [{ ...contact, href }];
  });
  return visible.length === 0 ? null : (
    <section className="business-contacts">
      <h3>{title}</h3>
      <ul>
        {visible.map((contact) => (
          <li key={`${contact.label}:${contact.href}`}>
            <a href={contact.href} rel="noopener noreferrer">
              {contact.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BusinessDock({
  directory,
  navigation,
  geolocation,
  observation,
}: BusinessDockProps) {
  const route = useSyncExternalStore(
    navigation.subscribe,
    navigation.getSnapshot,
    navigation.getSnapshot,
  );
  const { resolved } = useLocalization();
  const m = businessMessages[resolved];
  const [loaded, setLoaded] = useState<{
    key: string;
    result: BusinessSurfaceResult;
  }>();
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [locationState, setLocationState] = useState<
    "idle" | "pending" | "failed"
  >("idle");
  const generation = useRef(0);
  const organizationScroll = useRef(0);
  const label = route?.label;
  const requestKey = `${label ?? ""}/${route?.point ?? ""}`;
  useEffect(() => {
    if (label === undefined) return;
    const abort = new AbortController();
    let active = true;
    let refreshSequence = 0;
    const refresh = () => {
      const sequence = ++refreshSequence;
      void directory
        .read(label, abort.signal)
        .then((result) => {
          if (active && sequence === refreshSequence)
            setLoaded({ key: requestKey, result });
        })
        .catch(() => {
          if (active && sequence === refreshSequence)
            setLoaded({ key: requestKey, result: { kind: "unavailable" } });
        });
    };
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      active = false;
      abort.abort();
    };
  }, [directory, label, requestKey, attempt]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [label, route?.point, route?.cityId],
  );

  if (route === null) return null;
  const result = loaded?.key === requestKey ? loaded.result : undefined;
  const business = result?.kind === "ready" ? result.business : undefined;
  const published =
    business?.directory.kind === "ready" ? business.directory : undefined;
  const point = published?.points.find((p) => p.route === route.point);
  const inferred =
    observation === undefined || published === undefined
      ? undefined
      : cityForObservation(published.cities, observation);
  const cityId = route.cityId ?? inferred ?? point?.cityId;
  const city = published?.cities.find((c) => c.id === cityId);
  const points = published?.points.filter((p) => p.cityId === city?.id) ?? [];
  const navigate = (pointRoute?: string, selectedCity = cityId) => {
    generation.current++;
    setLocationState("idle");
    navigation.open(route.label, pointRoute, selectedCity);
  };
  const locate = async () => {
    if (published === undefined || locationState === "pending") return;
    const request = ++generation.current;
    setLocationState("pending");
    try {
      const observed =
        observation === undefined
          ? await geolocation.requestPosition({
              maximumAgeMs: 60_000,
              timeoutMs: 10_000,
            })
          : { kind: "observed" as const, position: observation };
      if (request !== generation.current) return;
      const found =
        observed.kind === "observed"
          ? cityForObservation(published.cities, observed.position)
          : undefined;
      if (found === undefined) {
        setLocationState("failed");
        setChoosing(true);
        return;
      }
      navigate(undefined, found);
      setChoosing(false);
    } catch {
      if (request === generation.current) {
        setLocationState("failed");
        setChoosing(true);
      }
    }
  };

  return (
    <section className="business-dock" aria-label="Business Bond">
      <DockWindow
        screen={`${route.label}/${route.point ?? ""}`}
        depth={route.point === undefined ? 0 : 1}
      >
        {route.point === undefined ? (
          <button
            className="business-back"
            type="button"
            onClick={() => navigation.close()}
          >
            {m.open}
          </button>
        ) : (
          <a
            className="business-back"
            href={navigation.href(route.label)}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              navigate();
            }}
          >
            ← {m.back} {business?.displayName ?? route.label}
          </a>
        )}
        <p className="business-kicker">Business Bond</p>
        <h2>{point?.displayName ?? business?.displayName ?? route.label}</h2>
        <div
          className="business-scroll"
          ref={(element) => {
            if (element !== null && route.point === undefined)
              element.scrollTop = organizationScroll.current;
          }}
          onScroll={(event) => {
            if (route.point === undefined)
              organizationScroll.current = event.currentTarget.scrollTop;
          }}
        >
          {result === undefined ? (
            <p role="status">{m.loading}</p>
          ) : result.kind !== "ready" ? (
            <div role="status">
              <p>{result.kind === "not-found" ? m.missing : m.unavailable}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                {m.retry}
              </button>
            </div>
          ) : route.point !== undefined ? (
            point === undefined ? (
              <p role="status">
                {published === undefined ? m.directory : m.missingPoint}
              </p>
            ) : (
              <>
                <section aria-label={m.assortment}>
                  <h3>{m.assortment}</h3>
                  {point.catalog.kind === "unavailable" ? (
                    <p role="status">{m.catalog}</p>
                  ) : point.catalog.offers.length === 0 ? (
                    <p>{m.emptyCatalog}</p>
                  ) : (
                    <ul className="business-offers">
                      {point.catalog.offers.map((offer) => (
                        <li key={offer.id}>
                          <small>{offer.category}</small>
                          <strong>{offer.name}</strong>
                          {offer.quantity === undefined ? null : (
                            <span>
                              {m.quantity}: {offer.quantity}
                            </span>
                          )}
                          {offer.price === undefined ? null : (
                            <span>
                              {m.price}: {offer.price}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <Contacts contacts={point.contacts} title={m.contacts} />
                <Contacts
                  contacts={business!.contacts}
                  title={`${m.contacts} · ${business!.displayName}`}
                />
              </>
            )
          ) : (
            <>
              <div className="business-city">
                <span>{m.city}</span>
                <button
                  type="button"
                  aria-expanded={choosing || city === undefined}
                  onClick={() => setChoosing((value) => !value)}
                >
                  {city?.name ?? m.choose} ▾
                </button>
              </div>
              {published === undefined ? (
                <p role="status">{m.directory}</p>
              ) : (
                <>
                  {choosing || city === undefined ? (
                    <div className="business-city-picker">
                      <label>
                        {m.search}
                        <input
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </label>
                      <ul>
                        {searchBusinessCities(published.cities, search).map(
                          (option) => (
                            <li key={option.id}>
                              <button
                                type="button"
                                onClick={() => {
                                  navigate(undefined, option.id);
                                  setChoosing(false);
                                }}
                              >
                                {option.name}
                                <small>
                                  {[option.region, option.country]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </small>
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                      {searchBusinessCities(published.cities, search).length ===
                      0 ? (
                        <p>{m.noCities}</p>
                      ) : null}
                      {city === undefined ? (
                        <button
                          type="button"
                          disabled={locationState === "pending"}
                          onClick={() => void locate()}
                        >
                          {locationState === "pending" ? m.locating : m.locate}
                        </button>
                      ) : null}
                      {locationState === "failed" ? (
                        <p role="status">{m.locationFailed}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {city === undefined ? (
                    <p>{m.chooseFirst}</p>
                  ) : points.length === 0 ? (
                    <p>{m.noPoints}</p>
                  ) : (
                    <ul className="business-points">
                      {points.map((item) => (
                        <li
                          key={`${item.id.owner_pub_dress}:${item.id.number}`}
                        >
                          <a
                            href={navigation.href(route.label, item.route)}
                            onClick={(event) => {
                              if (
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                              )
                                return;
                              event.preventDefault();
                              navigate(item.route);
                            }}
                          >
                            {item.displayName} →
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              <Contacts contacts={business!.contacts} title={m.contacts} />
            </>
          )}
        </div>
      </DockWindow>
    </section>
  );
}
