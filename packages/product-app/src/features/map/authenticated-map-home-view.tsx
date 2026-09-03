// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer } from "@nilx-one/map-contract";
import { useEffect, useRef, useState, type CSSProperties } from "react";

import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import "./authenticated-map-home-view.css";

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

function runtimeContract(runtime: RuntimeViewState): string | undefined {
  if (runtime.tone !== "ready") {
    return undefined;
  }
  const match = runtime.detail.match(/Contract\s+([^\s]+)\s+/i);
  return match?.[1];
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
  const contractVersion = runtimeContract(runtime);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    renderer.mount(map);
    return () => renderer.unmount();
  }, [renderer]);

  function focusAuthenticatedBond(): void {
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

  return (
    <main
      className="authenticated-map-home"
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

      <section className="bond-dock" aria-labelledby="bond-dock-title">
        <span className="bond-dock__kicker" id="bond-dock-title">
          Bond
        </span>
        <div className="bond-dock__pair">
          <button
            className="bond-dock__bond bond-dock__bond--active"
            type="button"
            data-focus-state={focusState}
            onClick={focusAuthenticatedBond}
            aria-label={`Focus map on this device for ${pubDress}`}
          >
            <span className="bond-dock__glyph">0x0</span>
            <strong>{pubDress}</strong>
            <small>
              You
              <i
                className="bond-dock__status-dot bond-dock__status-dot--authenticated"
                aria-hidden="true"
              />
              Authenticated
            </small>
          </button>
          <span className="bond-dock__link" aria-hidden="true">
            ←→
          </span>
          <button
            className="bond-dock__bond bond-dock__bond--unavailable"
            type="button"
            disabled
            aria-label="x0skai unavailable"
          >
            <span className="bond-dock__glyph">x0</span>
            <strong>x0skai</strong>
            <small>
              <i className="bond-dock__status-dot" aria-hidden="true" />
              Unavailable
            </small>
          </button>
        </div>
      </section>

      <span className="visually-hidden" aria-live="polite">
        {focusState === "locating"
          ? `Locating this device for ${pubDress}.`
          : focusState === "focused"
            ? `Map focused on this device for ${pubDress}.`
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
