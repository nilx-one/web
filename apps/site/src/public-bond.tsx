// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from "react";

import "./public-bond.css";

/** A WGS84 coordinate in decimal degrees, as read from the wire's E7 form. */
export interface PublicCoordinate {
  longitude: number;
  latitude: number;
}

/**
 * The owner-published location for a Bond's Avaia (see
 * `IdentityRepository::read_avaia_location` in the identity service). This is
 * never the local, never-persisted walking position described in
 * `avaia-walk.md`.
 */
export interface PublicAvaiaLocation {
  coordinate: PublicCoordinate;
}

export interface PublicAvaiaProjection {
  pubDress: string;
  avatarModel?: string;
  location?: PublicAvaiaLocation;
}

export interface PublicBondProjection {
  pubDress: string;
  pubDressUrl: string;
  avaia?: PublicAvaiaProjection;
}

export type PublicBondState =
  | { kind: "loading" }
  | { kind: "ready"; bond: PublicBondProjection }
  | { kind: "not-found" }
  | { kind: "unavailable" };

interface PublicBondPageProps {
  fetchImpl?: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Matches the E7 wire scale in `ox1_contracts::GEO_COORDINATE_E7_SCALE`. */
const GEO_COORDINATE_E7_SCALE = 10_000_000;

function parseCoordinate(value: unknown): PublicCoordinate | undefined {
  if (
    !isRecord(value) ||
    typeof value.longitude_e7 !== "string" ||
    typeof value.latitude_e7 !== "string"
  ) {
    return undefined;
  }
  const longitudeE7 = Number(value.longitude_e7);
  const latitudeE7 = Number(value.latitude_e7);
  if (!Number.isFinite(longitudeE7) || !Number.isFinite(latitudeE7)) {
    return undefined;
  }
  return {
    longitude: longitudeE7 / GEO_COORDINATE_E7_SCALE,
    latitude: latitudeE7 / GEO_COORDINATE_E7_SCALE,
  };
}

function parseAvaiaLocation(value: unknown): PublicAvaiaLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const coordinate = parseCoordinate(value.coordinate);
  return coordinate === undefined ? undefined : { coordinate };
}

function parseAvaiaProjection(
  value: unknown,
): PublicAvaiaProjection | undefined {
  if (!isRecord(value) || typeof value.pub_dress !== "string") {
    return undefined;
  }
  const location = parseAvaiaLocation(value.location);
  return {
    pubDress: value.pub_dress,
    ...(typeof value.avatar_model === "string"
      ? { avatarModel: value.avatar_model }
      : {}),
    ...(location === undefined ? {} : { location }),
  };
}

function parseProjection(value: unknown): PublicBondProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.pub_dress !== "string" ||
    typeof value.pub_dress_url !== "string"
  ) {
    return undefined;
  }
  const avaia = parseAvaiaProjection(value.avaia);
  return {
    pubDress: value.pub_dress,
    pubDressUrl: value.pub_dress_url,
    ...(avaia === undefined ? {} : { avaia }),
  };
}

function asciiFoldHostname(hostname: string): string {
  return hostname.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

export function isPublicBondHostname(hostname: string): boolean {
  const normalized = asciiFoldHostname(hostname).replace(/\.$/, "");
  const zone = ".nilx.one";
  if (!normalized.endsWith(zone)) {
    return false;
  }
  const label = normalized.slice(0, -zone.length);
  return (
    label.length > 0 &&
    !label.includes(".") &&
    (label.startsWith("0x") || label.startsWith("xn--"))
  );
}

export async function readPublicBond(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
): Promise<PublicBondState> {
  try {
    const response = await fetchImpl("/api/v1/identity/public", {
      cache: "no-store",
      credentials: "omit",
    });
    if (response.status === 404) {
      return { kind: "not-found" };
    }
    if (!response.ok) {
      return { kind: "unavailable" };
    }
    const projection = parseProjection(await response.json());
    return projection === undefined
      ? { kind: "unavailable" }
      : { kind: "ready", bond: projection };
  } catch {
    return { kind: "unavailable" };
  }
}

function PublicBondCard({ bond }: { bond: PublicBondProjection }) {
  return (
    <main className="public-bond-page">
      <article className="public-bond-card" aria-labelledby="public-bond-title">
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1 id="public-bond-title">{bond.pubDress}</h1>
        <a className="public-bond-address" href={bond.pubDressUrl}>
          {bond.pubDressUrl.replace(/^https:\/\//, "")}
        </a>

        <dl className="public-bond-facts">
          {bond.avaia === undefined ? null : (
            <div>
              <dt>Avaia</dt>
              <dd>{bond.avaia.pubDress}</dd>
            </div>
          )}
          {bond.avaia?.avatarModel === undefined ? null : (
            <div>
              <dt>body</dt>
              <dd>{bond.avaia.avatarModel}</dd>
            </div>
          )}
          {bond.avaia?.location === undefined ? null : (
            <div>
              <dt>location</dt>
              <dd>
                {bond.avaia.location.coordinate.latitude.toFixed(4)},{" "}
                {bond.avaia.location.coordinate.longitude.toFixed(4)}
              </dd>
            </div>
          )}
        </dl>

        <a className="public-bond-home" href="https://nilx.one/">
          enter nilx.one <span aria-hidden="true">↗</span>
        </a>
      </article>
      <footer>© 2026 aiaiaiai · aiaiaiai.org</footer>
    </main>
  );
}

function PublicBondMessage({ state }: { state: "not-found" | "unavailable" }) {
  return (
    <main className="public-bond-page">
      <section
        className="public-bond-card public-bond-card--message"
        role="status"
      >
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1>
          {state === "not-found"
            ? "Bond not found."
            : "Temporarily unavailable."}
        </h1>
        <p>
          {state === "not-found"
            ? "No Bond is allocated to this public address."
            : "The public identity service could not answer this address."}
        </p>
        <a className="public-bond-home" href="https://nilx.one/">
          nilx.one <span aria-hidden="true">↗</span>
        </a>
      </section>
      <footer>© 2026 aiaiaiai · aiaiaiai.org</footer>
    </main>
  );
}

export function PublicBondPage({ fetchImpl }: PublicBondPageProps) {
  const [state, setState] = useState<PublicBondState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void readPublicBond(fetchImpl).then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
    };
  }, [fetchImpl]);

  if (state.kind === "ready") {
    return <PublicBondCard bond={state.bond} />;
  }
  if (state.kind === "not-found" || state.kind === "unavailable") {
    return <PublicBondMessage state={state.kind} />;
  }
  return (
    <main className="public-bond-page" aria-busy="true">
      <section className="public-bond-card public-bond-card--message">
        <p className="public-bond-kicker">0x1 · Bond</p>
        <h1>Resolving address…</h1>
      </section>
    </main>
  );
}
