// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRenderer, MapRendererStatus } from "@nilx-one/map-contract";
import { StatusToastStack, type StatusToastItem } from "@nilx-one/ui";
import { useEffect, useRef, useState } from "react";

import { AppHeader, type HeaderAction } from "../../shell/app-header";
import { AppShell, type ShellSafeArea } from "../../shell/app-shell";
import {
  IDENTITY_ROUTE,
  WORLD_ROUTE,
  type ShellRoute,
  type ShellSection,
} from "../../shell/routes";
import { useShellPresentation } from "../../shell/shell-presentation";
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
  readonly safeArea: ShellSafeArea;
  /** The canonical route this surface is presenting. */
  readonly section?: ShellSection;
  readonly connectedProviders?: readonly ConnectedProvider[];
  readonly onLogout?: () => void;
  readonly onNavigate?: (route: ShellRoute) => void;
}

type FocusState = "idle" | "locating" | "focused" | "unavailable";
/** Identity detail is a state of the identity surface, never a separate route. */
type IdentityDetail = "profile-edit" | "add-hosts" | "providers-edit";

/**
 * Detail is scoped to the section that opened it, so leaving the identity
 * surface abandons it without a state synchronisation effect.
 */
interface IdentityDetailState {
  readonly section: ShellSection;
  readonly detail: IdentityDetail;
}
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

/** A transient renderer state belongs in the toast stack, not on the Dock. */
function mapStatusToast(
  status: MapRendererStatus,
  label: string,
  detail: string,
): StatusToastItem | undefined {
  if (status.kind === "ready") {
    return undefined;
  }

  return {
    id:
      status.kind === "unavailable"
        ? `map-unavailable-${status.reason}`
        : `map-${status.kind}`,
    kind: status.kind === "unavailable" ? "error" : "loading",
    title: label,
    description: detail,
  };
}

export function AuthenticatedMapHomeView({
  hostLabel,
  pubDress,
  renderer,
  runtime,
  safeArea,
  section = "world",
  connectedProviders = [],
  onLogout,
  onNavigate,
}: AuthenticatedMapHomeViewProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const [focusState, setFocusState] = useState<FocusState>("idle");
  const [detailState, setDetailState] = useState<
    IdentityDetailState | undefined
  >(undefined);
  const [appearance, setAppearance] = useState<AppearancePreference>(
    readAppearancePreference,
  );
  const [systemTheme, setSystemTheme] =
    useState<ResolvedAppearance>(systemAppearance);
  const [mapStatus, setMapStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );
  const [dismissedStatus, setDismissedStatus] = useState<string | undefined>(
    undefined,
  );
  const presentation = useShellPresentation();
  const resolvedAppearance = appearance === "auto" ? systemTheme : appearance;
  const contractVersion = runtimeContract(runtime);
  const mapViewModel = createMapFoundationViewModel(mapStatus);
  const activeDetail =
    detailState?.section === section ? detailState.detail : undefined;
  const dockScreen = section === "world" ? "home" : (activeDetail ?? section);
  const statusToast = mapStatusToast(
    mapStatus,
    mapViewModel.label,
    mapViewModel.detail,
  );
  const statusToasts =
    statusToast === undefined || statusToast.id === dismissedStatus
      ? []
      : [statusToast];
  const headerActions: readonly HeaderAction[] =
    onLogout === undefined
      ? []
      : [{ id: "sign-out", label: "Sign out", perform: onLogout }];

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
    const mapHost = mapHostRef.current;
    if (mapHost === null) return;
    renderer.mount(mapHost);
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

  function navigate(route: ShellRoute): void {
    onNavigate?.(route);
  }

  function openDetail(detail: IdentityDetail): void {
    setDetailState({ section, detail });
  }

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

  function leaveDetail(): void {
    if (activeDetail === undefined) {
      navigate(WORLD_ROUTE);
      return;
    }
    setDetailState(undefined);
  }

  function detailEyebrow(): string {
    if (section === "settings") return "Application";
    return "Personal Bond";
  }

  function detailTitle(): string {
    if (section === "settings") return "Settings";
    switch (activeDetail) {
      case "profile-edit":
        return "Edit profile";
      case "add-hosts":
        return "Add hosts";
      case "providers-edit":
        return "Providers";
      case undefined:
        return pubDress;
    }
  }

  return (
    <AppShell
      className="authenticated-map-home"
      presentation={presentation}
      safeArea={safeArea}
      data-theme={resolvedAppearance}
      data-focus-state={focusState}
      data-section={section}
      world={
        <>
          <div className="authenticated-map-home__map" aria-hidden="true">
            <div
              className="authenticated-map-home__map-host"
              ref={mapHostRef}
              style={{ width: "100%", height: "100%" }}
            />
          </div>
          <div className="authenticated-map-home__shade" aria-hidden="true" />
        </>
      }
      header={
        <AppHeader
          presentation={presentation}
          hostLabel={hostLabel}
          section={section}
          pubDress={pubDress}
          actions={headerActions}
          onNavigate={navigate}
        />
      }
      toasts={
        <StatusToastStack
          toasts={statusToasts}
          label="World status"
          placement="inline"
          onDismiss={setDismissedStatus}
        />
      }
      statusRail={
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
      }
      dock={
        <section
          className="bond-dock"
          data-screen={dockScreen}
          aria-labelledby="bond-dock-title"
        >
          {section === "world" ? (
            <>
              <div className="bond-dock__header">
                <span className="bond-dock__kicker" id="bond-dock-title">
                  Bond
                </span>
              </div>
              <div className="bond-dock__pair">
                <button
                  className="bond-dock__bond bond-dock__bond--active"
                  type="button"
                  onClick={() => navigate(IDENTITY_ROUTE)}
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
                  onClick={leaveDetail}
                >
                  <span aria-hidden="true">←</span>
                </button>
                <div>
                  <span className="interface-settings__eyebrow">
                    {detailEyebrow()}
                  </span>
                  <h2 id="bond-dock-title">{detailTitle()}</h2>
                </div>
                {section === "identity" && activeDetail === undefined ? (
                  <button
                    className="bond-dock__edit"
                    type="button"
                    onClick={() => openDetail("profile-edit")}
                  >
                    Edit
                  </button>
                ) : null}
              </div>

              {section === "identity" && activeDetail === undefined ? (
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
                              onClick={() => openDetail("add-hosts")}
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
                                onClick={() => openDetail("providers-edit")}
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

              {activeDetail === "profile-edit" ? (
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

              {section === "settings" ? (
                <>
                  <fieldset className="interface-settings__appearance">
                    <legend>Appearance</legend>
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
                    This is local interface presentation state. It does not
                    change Bond, BondChain, or shared Core state.
                  </p>
                </>
              ) : null}

              {activeDetail === "add-hosts" ? (
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
                          Authorize this Bond with your{" "}
                          {providerLabel(provider)} account
                        </small>
                      </span>
                      <span aria-hidden="true">→</span>
                    </a>
                  ))}
                  <p className="interface-settings__note">
                    Hosts are authentication bindings for this Bond. Telegram
                    Mini App and Discord Activity are host environments, not
                    additional provider identities.
                  </p>
                </div>
              ) : null}

              {activeDetail === "providers-edit" ? (
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
                      onClick={() => openDetail("add-hosts")}
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
      }
      overlay={
        <span className="visually-hidden" aria-live="polite">
          {focusState === "locating"
            ? "Locating this device for local map focus."
            : focusState === "focused"
              ? "Map camera focused near this device."
              : focusState === "unavailable"
                ? "Device location is unavailable."
                : ""}
        </span>
      }
    />
  );
}
