// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import "./authenticated-map-home-view.css";
import "./authenticated-map-settings.css";
import { createMapFoundationViewModel } from "./map-foundation-view-model";

export type ConnectedProvider = "telegram" | "discord";

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
  readonly connectedProviders?: readonly ConnectedProvider[];
  readonly onLogout?: () => void;
}

type FocusState = "idle" | "locating" | "focused" | "unavailable";
type HomeScreen =
  | "home"
  | "profile"
  | "profile-edit"
  | "map-settings"
  | "add-hosts"
  | "providers-edit";
type AppearancePreference = "light" | "dark" | "auto";
type ResolvedAppearance = "light" | "dark";

const APPEARANCE_STORAGE_KEY = "nilx-one.interface.appearance";

function runtimeContract(runtime: RuntimeViewState): string | undefined {
  if (runtime.tone !== "ready") return undefined;
  const match = runtime.detail.match(/Contract\s+([^\s]+)\s+/i);
  return match?.[1];
}

function readAppearancePreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto")
      return stored;
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

function providerLabel(provider: ConnectedProvider): string {
  return provider === "telegram" ? "Telegram" : "Discord";
}

function providerAbbreviation(provider: ConnectedProvider): string {
  return provider === "telegram" ? "TG" : "DC";
}

function providerConnectHref(provider: ConnectedProvider): string {
  return `/auth?provider=${provider}&intent=connect`;
}

export function AuthenticatedMapHomeView({
  hostLabel,
  pubDress,
  renderer,
  runtime,
  safeArea,
  connectedProviders = [],
  onLogout,
}: AuthenticatedMapHomeViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [focusState, setFocusState] = useState<FocusState>("idle");
  const [menuOpen, setMenuOpen] = useState(false);
  const [screen, setScreen] = useState<HomeScreen>("home");
  const [appearance, setAppearance] = useState<AppearancePreference>(
    readAppearancePreference,
  );
  const [systemTheme, setSystemTheme] =
    useState<ResolvedAppearance>(systemAppearance);
  const [mapStatus, setMapStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );
  const resolvedAppearance = appearance === "auto" ? systemTheme : appearance;
  const contractVersion = runtimeContract(runtime);
  const mapViewModel = createMapFoundationViewModel(mapStatus);

  // A map that never paints must say so. Without this the shell shows an empty
  // surface and a renderer, asset, or basemap failure is indistinguishable
  // from an ordinary dark map.
  useEffect(() => renderer.subscribe(setMapStatus), [renderer]);

  // Appearance is applied before mounting so the first paint already uses the
  // resolved style variant instead of loading light and swapping to dark.
  useEffect(() => {
    renderer.setAppearance(resolvedAppearance);
  }, [renderer, resolvedAppearance]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) return;
    renderer.mount(map);
    return () => renderer.unmount();
  }, [renderer]);

  useEffect(() => {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    } catch {
      // Persistence is best-effort only.
    }
  }, [appearance]);

  useEffect(() => {
    if (window.matchMedia === undefined) return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => setSystemTheme(media.matches ? "light" : "dark");
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  function focusMapNearDevice(): void {
    if (focusState === "locating") return;
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

  function openMapSettings(): void {
    setMenuOpen(false);
    setScreen("map-settings");
  }

  function detailBackTarget(): HomeScreen {
    switch (screen) {
      case "profile-edit":
      case "add-hosts":
      case "providers-edit":
        return "profile";
      case "profile":
      case "map-settings":
      case "home":
        return "home";
    }
  }

  function detailEyebrow(): string {
    switch (screen) {
      case "profile":
      case "profile-edit":
      case "add-hosts":
      case "providers-edit":
        return "Personal Bond";
      case "map-settings":
        return "Map settings";
      case "home":
        return "Bond";
    }
  }

  function detailTitle(): string {
    switch (screen) {
      case "profile":
        return pubDress;
      case "profile-edit":
        return "Edit profile";
      case "add-hosts":
        return "Add hosts";
      case "providers-edit":
        return "Providers";
      case "map-settings":
        return "Appearance";
      case "home":
        return "Bond";
    }
  }

  return (
    <main
      className="authenticated-map-home"
      data-theme={resolvedAppearance}
      data-focus-state={focusState}
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
              <button type="button" role="menuitem" onClick={openMapSettings}>
                Map settings
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
                aria-label="Open map settings"
                onClick={openMapSettings}
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
                aria-label="Back"
                onClick={() => setScreen(detailBackTarget())}
              >
                <span aria-hidden="true">←</span>
              </button>
              <div>
                <span className="interface-settings__eyebrow">
                  {detailEyebrow()}
                </span>
                <h2 id="bond-dock-title">{detailTitle()}</h2>
              </div>
              {screen === "profile" ? (
                <button
                  className="bond-dock__edit"
                  type="button"
                  onClick={() => setScreen("profile-edit")}
                >
                  Edit
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
                    <dt>Providers</dt>
                    <dd>
                      <span className="provider-controls">
                        {connectedProviders.length === 0 ? (
                          <button
                            className="provider-control provider-control--add"
                            type="button"
                            aria-label="Add host"
                            onClick={() => setScreen("add-hosts")}
                          >
                            +
                          </button>
                        ) : (
                          <>
                            {connectedProviders.map((provider) => (
                              <span
                                className="provider-control provider-control--connected"
                                key={provider}
                                aria-label={`${providerLabel(provider)} connected`}
                                title={providerLabel(provider)}
                              >
                                {providerAbbreviation(provider)}
                              </span>
                            ))}
                            <button
                              className="provider-control provider-control--edit"
                              type="button"
                              onClick={() => setScreen("providers-edit")}
                            >
                              Edit
                            </button>
                          </>
                        )}
                      </span>
                    </dd>
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
              </div>
            ) : null}

            {screen === "profile-edit" ? (
              <div className="profile-edit">
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
                    <dt>Home</dt>
                    <dd>Not set</dd>
                  </div>
                  <div>
                    <dt>Family</dt>
                    <dd>Not set</dd>
                  </div>
                </dl>
                <p className="interface-settings__note">
                  Provider connections are managed separately and are never
                  changed by profile editing.
                </p>
              </div>
            ) : null}

            {screen === "map-settings" ? (
              <>
                <fieldset className="interface-settings__appearance">
                  <legend>Mode</legend>
                  {(["light", "dark", "auto"] as const).map((mode) => (
                    <label key={mode} className="interface-settings__option">
                      <span>
                        <strong>
                          {mode.charAt(0).toUpperCase() + mode.slice(1)}
                        </strong>
                        <small>
                          {mode === "auto"
                            ? "Follow this device"
                            : `Keep the map ${mode}`}
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
                  This is local map presentation state. It does not change Bond,
                  BondChain, or shared Core state.
                </p>
              </>
            ) : null}

            {screen === "add-hosts" ? (
              <div className="host-connect-list">
                {(["telegram", "discord"] as const).map((provider) => (
                  <a
                    className="host-connect-button"
                    href={providerConnectHref(provider)}
                    key={provider}
                  >
                    <span
                      className="provider-control provider-control--connected"
                      aria-hidden="true"
                    >
                      {providerAbbreviation(provider)}
                    </span>
                    <span>
                      <strong>Connect with {providerLabel(provider)}</strong>
                      <small>
                        Authorize this Bond with your {providerLabel(provider)}{" "}
                        account
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </a>
                ))}
                <p className="interface-settings__note">
                  Hosts are authentication bindings for this Bond. Telegram Mini
                  App and Discord Activity are host environments, not additional
                  provider identities.
                </p>
              </div>
            ) : null}

            {screen === "providers-edit" ? (
              <div className="provider-management">
                <div className="provider-management__connected">
                  {connectedProviders.map((provider) => (
                    <div key={provider}>
                      <span
                        className="provider-control provider-control--connected"
                        aria-hidden="true"
                      >
                        {providerAbbreviation(provider)}
                      </span>
                      <span>
                        <strong>{providerLabel(provider)}</strong>
                        <small>Connected</small>
                      </span>
                    </div>
                  ))}
                </div>
                {connectedProviders.length < 2 ? (
                  <button
                    className="bond-profile__action"
                    type="button"
                    onClick={() => setScreen("add-hosts")}
                  >
                    + Add host
                  </button>
                ) : null}
                <p className="interface-settings__note">
                  Provider changes are separate from Bond profile editing.
                </p>
              </div>
            ) : null}
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
      {mapStatus.kind === "ready" ? null : (
        <section
          className={`map-chip map-chip--${mapViewModel.tone}`}
          aria-live="polite"
        >
          <i aria-hidden="true" />
          <span>
            <strong>{mapViewModel.label}</strong>
            <small>{mapViewModel.detail}</small>
          </span>
        </section>
      )}
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
