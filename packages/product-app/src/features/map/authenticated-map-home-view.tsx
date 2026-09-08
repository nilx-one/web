// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { GeolocationCapability } from "@nilx-one/host-contract";
import type {
  MapDimension,
  MapRenderer,
  MapRendererStatus,
} from "@nilx-one/map-contract";
import { StatusToastStack, type StatusToastItem } from "@nilx-one/ui";
import { useEffect, useRef, useState } from "react";

import { AppHeader, type HeaderAction } from "../../shell/app-header";
import { AppShell, type ShellSafeArea } from "../../shell/app-shell";
import {
  WORLD_ROUTE,
  type ShellRoute,
  type ShellSection,
} from "../../shell/routes";
import { useShellPresentation } from "../../shell/shell-presentation";
import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import type { AddressSlugViewState } from "../identity/profile-slug-view-model";
import "./authenticated-map-home-view.css";
import "./authenticated-map-settings.css";
import {
  deviceLocationPosition,
  type DeviceLocationState,
} from "./device-location";
import { LocationControl } from "./location-control";
import { useDeviceLocation } from "./use-device-location";
import { createLocationControlViewModel } from "./location-control-view-model";
import {
  cameraFramesPosition,
  cameraMotion,
  closeUpCamera,
  firstFixCamera,
  locationCameraPadding,
  recenterCamera,
} from "./location-camera-policy";
import { createMapFoundationViewModel } from "./map-foundation-view-model";
import {
  createBondDockViewState,
  type AvaiaAvailability,
  type DockSeat,
} from "./bond-dock-view-model";

export type ConnectedProvider = "telegram" | "discord";

export interface AuthenticatedMapHomeViewProps {
  readonly hostLabel: string;
  readonly pubDress: string;
  readonly avaiaPubDress?: string;
  readonly renderer: MapRenderer;
  /**
   * The host capability. This surface never reaches for a platform geolocation
   * API of its own, and the renderer never asks for a position at all.
   */
  readonly geolocation: GeolocationCapability;
  readonly runtime: RuntimeViewState;
  readonly safeArea: ShellSafeArea;
  /** The canonical route this surface is presenting. */
  readonly section?: ShellSection;
  readonly connectedProviders?: readonly ConnectedProvider[];
  /**
   * What this device can do about the Avaia runtime. Without a published
   * runtime there is nothing to download, which is what "unavailable" says.
   */
  readonly avaiaAvailability?: AvaiaAvailability;
  /** Starts fetching that runtime. Absent means this host cannot fetch it. */
  readonly onPrepareAvaia?: () => void;
  /**
   * The two addresses this Bond may name: its own, and its Avaia's. Without
   * them the profile presents the addresses it already has and offers nothing
   * to change.
   */
  readonly slugEdit?: AddressSlugViewState;
  readonly avaiaEdit?: AddressSlugViewState;
  readonly onSlugChange?: (slug: string) => void;
  readonly onSlugSubmit?: () => void;
  readonly onAvaiaChange?: (slug: string) => void;
  readonly onAvaiaSubmit?: () => void;
  readonly onLogout?: () => void;
  readonly onNavigate?: (route: ShellRoute) => void;
}

/**
 * The world's presentation of the device-location lifecycle. It drives shell
 * material only: a focused camera is never evidence of Bond presence.
 */
type FocusState = "idle" | "locating" | "focused" | "unavailable";

function focusStateFor(location: DeviceLocationState): FocusState {
  switch (location.kind) {
    case "locating":
      return "locating";
    case "active":
      return "focused";
    case "denied":
    case "unsupported":
    case "unavailable":
      return "unavailable";
    default:
      return "idle";
  }
}

/** Identity detail is a state of the identity surface, never a separate route. */
type IdentityDetail = "add-hosts" | "providers-edit";

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
const DIMENSION_STORAGE_KEY = "nilx-one.interface.dimension";

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

function readDimensionPreference(): MapDimension {
  try {
    const stored = window.localStorage.getItem(DIMENSION_STORAGE_KEY);
    if (stored === "flat" || stored === "volumetric") return stored;
  } catch {
    // Storage is optional. The interface remains usable with an in-memory preference.
  }
  return "volumetric";
}

function prefersReducedMotion(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
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

/**
 * One address, named in place. There is no separate edit screen: the profile
 * shows what a Bond is and lets it be changed where it is read.
 */
function AddressField({
  id,
  label,
  state,
  fallback,
  onChange,
  onSubmit,
}: {
  readonly id: string;
  readonly label: string;
  readonly state: AddressSlugViewState | undefined;
  readonly fallback: string;
  readonly onChange: ((slug: string) => void) | undefined;
  readonly onSubmit: (() => void) | undefined;
}) {
  if (state === undefined || state.kind === "fixed") {
    return (
      <dl className="bond-profile__rows">
        <div>
          <dt>{label}</dt>
          <dd>
            {state?.address === undefined || state.address.length === 0
              ? fallback
              : state.address}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <form
      className="profile-edit__form"
      onSubmit={(event) => {
        event.preventDefault();
        if (state.canSave) onSubmit?.();
      }}
    >
      <label className="interface-settings__eyebrow" htmlFor={id}>
        {label}
      </label>
      <div className="profile-edit__address">
        <span className="profile-edit__discriminator" aria-hidden="true">
          {state.prefix}
        </span>
        <input
          id={id}
          name={`${id}-value`}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={state.slug}
          disabled={state.busy}
          aria-describedby={`${id}-note`}
          aria-invalid={state.error !== undefined}
          onChange={(event) => onChange?.(event.currentTarget.value)}
        />
        <button
          className="profile-edit__save"
          type="submit"
          disabled={!state.canSave}
        >
          {state.busy ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="profile-edit__note" id={`${id}-note`}>
        {state.note}
      </p>
      {state.error === undefined ? null : (
        <p className="profile-edit__error" role="alert">
          {state.error}
        </p>
      )}
      {state.saved === undefined ? null : (
        <p className="profile-edit__saved" role="status">
          {`Saved. This is ${state.saved}.`}
        </p>
      )}
    </form>
  );
}

export function AuthenticatedMapHomeView({
  hostLabel,
  pubDress,
  avaiaPubDress,
  renderer,
  geolocation,
  runtime,
  safeArea,
  section = "world",
  connectedProviders = [],
  avaiaAvailability = "unavailable",
  onPrepareAvaia,
  slugEdit,
  avaiaEdit,
  onSlugChange,
  onSlugSubmit,
  onAvaiaChange,
  onAvaiaSubmit,
  onLogout,
  onNavigate,
}: AuthenticatedMapHomeViewProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const location = useDeviceLocation(geolocation);
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
  // Who is at the wheel is presentation: it moves nothing in the shared world.
  const [wheel, setWheel] = useState<DockSeat>("bond");
  const [dimension, setDimension] = useState<MapDimension>(
    readDimensionPreference,
  );
  // The camera the renderer actually holds, and whether a person put it there.
  const [camera, setCamera] = useState(() => renderer.getCamera());
  const cameraMovedByPerson = useRef(false);
  const firstFixApplied = useRef(false);
  const presentation = useShellPresentation();
  const observedPosition = deviceLocationPosition(location.state);
  const cameraCentered =
    observedPosition !== undefined &&
    cameraFramesPosition(camera, observedPosition);
  const locationControl = createLocationControlViewModel(
    location.state,
    cameraCentered,
  );
  const focusState: FocusState = focusStateFor(location.state);
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
  const avaiaLabel = avaiaPubDress ?? "Avaia";

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
    renderer.setDimension(dimension);
  }, [renderer, dimension]);

  // Nothing is asked of the host until the persistent world actually renders.
  // Renderer readiness is a presentation fact; it is what gates the request,
  // not what performs it.
  useEffect(() => {
    if (mapStatus.kind !== "ready") return;
    location.activate();
  }, [location, mapStatus.kind]);

  // Camera state is the renderer's. The world only observes it, so it can tell
  // a camera a person moved from one the application moved.
  useEffect(
    () =>
      renderer.subscribeCamera((change) => {
        setCamera(change.camera);
        if (change.gesture) {
          cameraMovedByPerson.current = true;
        }
      }),
    [renderer],
  );

  // The observation reaches the renderer as presentation geometry and display
  // text. It is never persisted, sent to a backend, or written to telemetry.
  useEffect(() => {
    if (observedPosition === undefined) {
      renderer.setObservedPosition(null);
      renderer.setObservedPositionLabel(null);
      return;
    }

    renderer.setObservedPosition({
      center: [observedPosition.longitude, observedPosition.latitude],
      accuracyMeters: observedPosition.accuracyMeters,
    });
    renderer.setObservedPositionLabel({
      title: pubDress,
      detail: "This device",
    });
  }, [observedPosition, pubDress, renderer]);

  // The first fix of a world recenters once. Later updates move the marker;
  // they never take the camera back from the person holding it.
  useEffect(() => {
    if (observedPosition === undefined || firstFixApplied.current) return;
    firstFixApplied.current = true;
    if (cameraMovedByPerson.current) return;

    const context = { presentation, dimension, safeArea };
    renderer.setCamera(firstFixCamera(observedPosition, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
  }, [dimension, observedPosition, presentation, renderer, safeArea]);

  useEffect(() => {
    try {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
    } catch {
      // Persistence is best-effort only.
    }
  }, [appearance]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DIMENSION_STORAGE_KEY, dimension);
    } catch {
      // Persistence is best-effort only.
    }
  }, [dimension]);

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

  /**
   * The one explicit user-gesture path. It either asks the host — which is
   * also the retry when a platform refuses to prompt without a gesture — or
   * moves the camera back onto the latest observation. It never refetches a
   * position it already has.
   */
  const dock = createBondDockViewState({
    pubDress,
    avaiaPubDress,
    wheel,
    avaia: avaiaAvailability,
    focusable: observedPosition !== undefined,
    downloadable: onPrepareAvaia !== undefined,
  });

  /**
   * The identity at the wheel is where the world looks. Focusing it is a camera
   * move to the closest scale this policy allows, never a claim of presence.
   */
  function focusWorldOnWheel(): void {
    if (observedPosition === undefined) return;
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(closeUpCamera(observedPosition, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  /** The identity that is spectating takes the wheel, when it can. */
  function activateSpectator(): void {
    if (dock.handover === "download") {
      onPrepareAvaia?.();
      return;
    }
    if (dock.handover === "switch") {
      setWheel(wheel === "bond" ? "avaia" : "bond");
    }
  }

  function activateLocationControl(): void {
    if (locationControl.intent === "request") {
      location.requestFromGesture();
      return;
    }

    if (
      locationControl.intent !== "recenter" ||
      observedPosition === undefined
    ) {
      return;
    }

    const context = { presentation, dimension, safeArea };
    renderer.setCamera(recenterCamera(observedPosition, camera, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
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
                  disabled={!dock.left.actionable}
                  onClick={focusWorldOnWheel}
                  aria-label={dock.left.actionLabel}
                >
                  <span className="bond-dock__glyph">{dock.left.glyph}</span>
                  <strong>{dock.left.address}</strong>
                  <small>
                    {dock.left.seat === "bond" ? "You" : "AI"}
                    <i
                      className={`bond-dock__status-dot bond-dock__status-dot--${dock.left.tone}`}
                      aria-hidden="true"
                    />
                    {dock.left.role}
                  </small>
                </button>
                <span
                  className="bond-dock__link"
                  aria-label="No reciprocal relationship asserted"
                >
                  —
                </span>
                <button
                  className={`bond-dock__bond${
                    dock.right.actionable ? "" : " bond-dock__bond--unavailable"
                  }`}
                  type="button"
                  disabled={!dock.right.actionable}
                  onClick={activateSpectator}
                  aria-label={dock.right.actionLabel}
                >
                  <span className="bond-dock__glyph">{dock.right.glyph}</span>
                  <strong>{dock.right.address}</strong>
                  <small>
                    {dock.right.seat === "bond" ? "You" : "AI"}
                    <i
                      className={`bond-dock__status-dot bond-dock__status-dot--${dock.right.tone}`}
                      aria-hidden="true"
                    />
                    {dock.right.role}
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
              </div>

              {section === "identity" && activeDetail === undefined ? (
                <div className="bond-profile">
                  <AddressField
                    id="profile-slug"
                    label="pub_dress"
                    state={slugEdit}
                    fallback={pubDress}
                    onChange={onSlugChange}
                    onSubmit={onSlugSubmit}
                  />
                  <AddressField
                    id="avaia-slug"
                    label="avaia"
                    state={avaiaEdit}
                    fallback={avaiaLabel}
                    onChange={onAvaiaChange}
                    onSubmit={onAvaiaSubmit}
                  />
                  <dl className="bond-profile__rows">
                    <div>
                      <dt>Providers</dt>
                      <dd>
                        <span className="provider-controls">
                          {connectedProviders.map((provider) => (
                            <button
                              className="provider-control provider-control--connected"
                              key={provider}
                              type="button"
                              aria-label={`${providerLabel(provider)} connected`}
                              title={providerLabel(provider)}
                              onClick={() => openDetail("providers-edit")}
                            >
                              {providerAbbreviation(provider)}
                            </button>
                          ))}
                          <button
                            className="provider-control provider-control--add"
                            type="button"
                            aria-label="Add host"
                            onClick={() => openDetail("add-hosts")}
                          >
                            +
                          </button>
                        </span>
                      </dd>
                    </div>
                  </dl>
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
                  <fieldset className="interface-settings__appearance">
                    <legend>Depth</legend>
                    {(["volumetric", "flat"] as const).map((mode) => (
                      <label key={mode} className="interface-settings__option">
                        <span>
                          <strong>{mode === "flat" ? "2D" : "3D"}</strong>
                          <small>
                            {mode === "flat"
                              ? "Keep buildings as footprints"
                              : "Raise buildings at close zoom"}
                          </small>
                        </span>
                        <input
                          type="radio"
                          name="dimension"
                          value={mode}
                          checked={dimension === mode}
                          onChange={() => setDimension(mode)}
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
        <>
          <LocationControl
            viewModel={locationControl}
            onActivate={activateLocationControl}
          />
          {/* The canvas marker has no text of its own, so the observation's
              meaning is announced here rather than left to a cyan dot. */}
          <span className="visually-hidden" aria-live="polite">
            {focusState === "locating"
              ? "Locating this device for local map focus."
              : focusState === "focused"
                ? "Map camera focused near this device."
                : focusState === "unavailable"
                  ? "Device location is unavailable."
                  : ""}
          </span>
        </>
      }
    />
  );
}
