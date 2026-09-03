// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import "./authenticated-map-home-view.css";
import "./authenticated-map-settings.css";

export interface AuthenticatedMapHomeViewProps {
  readonly hostLabel: string;
  readonly pubDress: string;
  readonly renderer: MapRenderer;
  readonly runtime: RuntimeViewState;
  readonly safeArea: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly onLogout?: () => void;
}

type FocusState = "idle" | "locating" | "focused" | "unavailable";
type HomeScreen = "home" | "profile" | "settings";
type AppearancePreference = "light" | "dark" | "auto";
type ResolvedAppearance = "light" | "dark";

const APPEARANCE_STORAGE_KEY = "nilx-one.interface.appearance";

function runtimeContract(runtime: RuntimeViewState): string | undefined {
  if (runtime.tone !== "ready") {
    return undefined;
  }
  const match = runtime.detail.match(/Contract\s+([^\s]+)\s+/i);
  return match?.[1];
}

function readAppearancePreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // Storage is optional. The interface remains usable with an in-memory preference.
  }
  return "auto";
}

function systemAppearance(): ResolvedAppearance {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function resolveAppearance(
  preference: AppearancePreference,
): ResolvedAppearance {
  return preference === "auto" ? systemAppearance() : preference;
}

export function AuthenticatedMapHomeView({
  hostLabel,
  pubDress,
  renderer,
  runtime,
  safeArea,
  onLogout,
}: AuthenticatedMapHomeViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [focusState, setFocusState] = useState<FocusState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [screen, setScreen] = useState<HomeScreen>("home");
  const [appearance, setAppearance] = useState<AppearancePreference>(
    readAppearancePreference,
  );
  const [resolvedAppearance, setResolvedAppearance] =
    useState<ResolvedAppearance>(() => resolveAppearance(readAppearancePreference()));
  const contractVersion = runtimeContract(runtime);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    renderer.mount(map);
    return () => renderer.unmount();
  }, [renderer]);

  useEffect(() => {
    setResolvedAppearance(resolveAppearance(appearance));
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    } catch {
      // Persistence is best-effort only.
    }

    if (appearance !== "auto" || window.matchMedia === undefined) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setResolvedAppearance(media.matches ? "light" : "dark");
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [appearance]);

  function focusMapNearDevice(): void {
    if (focusState === "locating") {
      return;
    }
    if (navigator.geolocation === undefined) {
      setFocusState("unavailable");
      return;
    }

    setFocusState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        renderer.setCamera({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: 13,
          bearing: 0,
          pitch: 42,
        });
        setFocusState("focused");
      },
      () => setFocusState("unavailable"),
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 8_000 },
    );
  }

  function openSettings(): void {
    setMenuOpen(false);
    setScreen("settings");
  }

  return (
    <main
      className="authenticated-map-home"
      data-theme={resolvedAppearance}
      style={
        {
          "--safe-top": `${safeArea.top}px`,
          "--safe-right": `${safeArea.right}px`,
          "--safe-bottom": `${safeArea.bottom}px`,
          "--safe-left": `${safeArea.left}px`,
        } as CSSProperties
      }
    >
      <div
        className="authenticated-map-home__map"
        ref={mapRef}
        aria-hidden="true"
      />
      <div className="authenticated-map-home__shade" aria-hidden="true" />

      <header className="authenticated-map-home__topbar">
        <a
          className="authenticated-map-home__wordmark"
          href="/"
          aria-label="0x1 home"
        >
          0x1
        </a>
        <div className="authenticated-map-home__host-area">
          <span className="authenticated-map-home__host">
            <i aria-hidden="true" />
            {hostLabel}
          </span>
          <button
            className="authenticated-map-home__menu-trigger"
            type="button"
            aria-label="Open host menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {menuOpen ? (
            <div className="authenticated-map-home__menu" role="menu">
              <span>{hostLabel}</span>
              <button type="button" role="menuitem" onClick={openSettings}>
                Interface settings
              </button>
              {onLogout === undefined ? null : (
                <button type="button" role="menuitem" onClick={onLogout}>
                  Sign out
                </button>
              )}
            </div>
          ) : null}
        </div>
      </header>

      <section
        className="authenticated-map-home__hero"
        aria-labelledby="identity-title"
      >
        <span className="authenticated-map-home__eyebrow">
          <b>0x1</b> identity
        </span>
        <h1 id="identity-title">You’re in.</h1>
        <p>
          Authenticated as <strong>{pubDress}</strong>
        </p>
      </section>

      <section
        className="bond-dock"
        data-screen={screen}
        aria-labelledby="bond-dock-title"
      >
        {screen === "home" ? (
          <>
            <div className="bond-dock__header">
              <span className="bond-dock__kicker" id="bond-dock-title">
                Bond
              </span>
              <button
                className="bond-dock__settings"
                type="button"
                aria-label="Open interface settings"
                onClick={openSettings}
              >
                <span aria-hidden="true">⚙︎</span>
              </button>
            </div>
            <div className="bond-dock__pair">
              <button
                className="bond-dock__bond bond-dock__bond--active"
                type="button"
                onClick={() => setScreen("profile")}
                aria-label={`Open Bond profile for ${pubDress}`}
              >
                <span className="bond-dock__glyph">0x0</span>
                <strong>{pubDress}</strong>
                <small>
                  You
                  <i
                    className="bond-dock__status-dot bond-dock__status-dot--authenticated"
                    aria-hidden="true"
                  />
                  spectate
                </small>
              </button>
              <span
                className="bond-dock__link"
                aria-label="No reciprocal relationship asserted"
              >
                —
              </span>
              <button
                className="bond-dock__bond bond-dock__bond--unavailable"
                type="button"
                disabled
                aria-label="x0skai AI runtime unavailable on this host"
              >
                <span className="bond-dock__glyph">x0</span>
                <strong>x0skai</strong>
                <small>
                  AI
                  <i className="bond-dock__status-dot" aria-hidden="true" />
                  unavailable
                </small>
              </button>
            </div>
          </>
        ) : (
          <div className="bond-dock__detail">
            <div className="bond-dock__detail-header">
              <button
                className="interface-settings__back"
                type="button"
                aria-label="Back to Bond"
                onClick={() => setScreen("home")}
              >
                <span aria-hidden="true">←</span>
              </button>
              <div>
                <span className="interface-settings__eyebrow">
                  {screen === "profile" ? "Personal Bond" : "0x1 interface"}
                </span>
                <h2 id="bond-dock-title">
                  {screen === "profile" ? pubDress : "Appearance"}
                </h2>
              </div>
              {screen === "profile" ? (
                <button
                  className="bond-dock__settings"
                  type="button"
                  aria-label="Open interface settings"
                  onClick={openSettings}
                >
                  <span aria-hidden="true">⚙︎</span>
                </button>
              ) : null}
            </div>

            {screen === "profile" ? (
              <div className="bond-profile">
                <dl className="bond-profile__rows">
                  <div>
                    <dt>pub_dress</dt>
                    <dd>{pubDress}</dd>
                  </div>
                  <div>
                    <dt>Age</dt>
                    <dd>Not set</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>Not available yet</dd>
                  </div>
                  <div>
                    <dt>Providers</dt>
                    <dd>Profile projection not available yet</dd>
                  </div>
                  <div>
                    <dt>Home</dt>
                    <dd>Not set · map selection later</dd>
                  </div>
                  <div>
                    <dt>Family</dt>
                    <dd>Not set</dd>
                  </div>
                  <div>
                    <dt>Closest Bond</dt>
                    <dd>No Relationship projection yet</dd>
                  </div>
                  <div>
                    <dt>BondChains</dt>
                    <dd>No projection available yet</dd>
                  </div>
                </dl>
                <button
                  className="bond-profile__action"
                  type="button"
                  onClick={focusMapNearDevice}
                  disabled={focusState === "locating"}
                >
                  {focusState === "locating"
                    ? "Locating…"
                    : focusState === "focused"
                      ? "Focused on this device"
                      : focusState === "unavailable"
                        ? "Location unavailable"
                        : "Focus map near this device"}
                </button>
                <p className="interface-settings__note">
                  Profile rows only present known state. Relationship and
                  provider truth stay outside the UI until their projections are
                  available.
                </p>
              </div>
            ) : (
              <>
                <fieldset className="interface-settings__appearance">
                  <legend>Mode</legend>
                  {(["light", "dark", "auto"] as const).map((mode) => (
                    <label key={mode} className="interface-settings__option">
                      <span>
                        <strong>{mode[0].toUpperCase() + mode.slice(1)}</strong>
                        <small>
                          {mode === "auto"
                            ? "Follow this device"
                            : `Keep the interface ${mode}`}
                        </small>
                      </span>
                      <input
                        type="radio"
                        name="appearance"
                        value={mode}
                        checked={appearance === mode}
                        onChange={() => setAppearance(mode)}
                      />
                    </label>
                  ))}
                </fieldset>
                <p className="interface-settings__note">
                  This is a local interface preference. It does not change Bond,
                  BondChain, or shared Core state.
                </p>
              </>
            )}
          </div>
        )}
      </section>

      <span className="visually-hidden" aria-live="polite">
        {focusState === "locating"
          ? "Locating this device for local map focus."
          : focusState === "focused"
            ? "Map camera focused near this device."
            : focusState === "unavailable"
              ? "Device location is unavailable."
              : `Authenticated as ${pubDress}.`}
      </span>

      <footer className="authenticated-map-home__footer">
        <span>0x1 · pre-alpha</span>
        <span>© 2026 aiaiaiai · nilx.one</span>
      </footer>

      <section
        className={`core-chip core-chip--${runtime.tone}`}
        aria-live="polite"
      >
        <i aria-hidden="true" />
        <span>
          <strong>{runtime.label}</strong>
          {contractVersion === undefined ? null : (
            <small>contract {contractVersion}</small>
          )}
        </span>
      </section>
    </main>
  );
}
