// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  BondProviderConnections,
  BondProviderType,
} from "@nilx-one/application";
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
import { chooseAppearance, useAppearance } from "../../shell/appearance";
import { DockWindow } from "../../shell/dock-window";
import {
  IDENTITY_ROUTE,
  WORLD_ROUTE,
  type ShellRoute,
  type ShellSection,
} from "../../shell/routes";
import { useShellPresentation } from "../../shell/shell-presentation";
import { AvaiaSetupView } from "../avaia/avaia-setup-view";
import { useAvaiaProfile } from "../avaia/use-avaia-profile";
import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import type { AvatarChoiceViewState } from "../identity/avatar-choice-view-model";
import {
  createBondProvidersViewState,
  type ProviderRowViewState,
} from "../identity/bond-providers-view-model";
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
import { AVATAR_HANDLE_ID, createSelfAvatarHandle } from "./avatar-presence";
import {
  createBondDockViewState,
  type AvaiaAvailability,
  type DockSeat,
} from "./bond-dock-view-model";

/** The provider types this client can present. The domain owns the list. */
export type ConnectedProvider = BondProviderType;

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
  /**
   * The provider accounts this Bond carries. Account text never reaches this
   * surface as content: an attachment resolves where it opens, nothing more.
   */
  readonly connectedProviders?: BondProviderConnections;
  /** The providers whose URL scheme this host can hand to the platform. */
  readonly providerDeepLinks?: readonly ConnectedProvider[];
  /**
   * Detaches a provider from this Bond. It is a local disconnection: no
   * external account is deleted, here or anywhere this can reach.
   */
  readonly onDisconnectProvider?: (provider: ConnectedProvider) => void;
  /**
   * What this device can do about the Avaia runtime. Without a published
   * runtime there is nothing to download, which is what "unavailable" says.
   */
  readonly avaiaAvailability?: AvaiaAvailability;
  /** Starts fetching that runtime. Absent means this host cannot fetch it. */
  readonly onPrepareAvaia?: () => void;
  /**
   * Legacy address-only edit state. Contract-8 clients use the owner Avaia
   * profile surface instead; these remain for older IdentityAccessPort hosts.
   */
  readonly slugEdit?: AddressSlugViewState;
  readonly avaiaEdit?: AddressSlugViewState;
  /** The body this Bond is represented by, and the studies it may choose. */
  readonly avatarChoice?: AvatarChoiceViewState;
  readonly onAvatarChoice?: (
    model: AvatarChoiceViewState["options"][number]["model"],
  ) => void;
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

/** Identity detail is a state of the Dock, never a separate route. */
type IdentityDetail = "providers" | "avaia";

/**
 * Detail is scoped to the section that opened it, so leaving that section
 * abandons it without making the detail a lifecycle owner.
 */
interface IdentityDetailState {
  readonly section: ShellSection;
  readonly detail: IdentityDetail;
}

/** One ambient slot: the cadence the sampler itself changes clips on. */
const AVATAR_AMBIENT_REFRESH_MS = 8_000;
const DIMENSION_STORAGE_KEY = "nilx-one.interface.dimension";

function runtimeContract(runtime: RuntimeViewState): string | undefined {
  if (runtime.tone !== "ready") return undefined;
  const match = runtime.detail.match(/Contract\s+([^\s]+)\s+/i);
  return match?.[1];
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

/** A transient renderer state belongs in the toast stack, not on the Dock. */
function mapStatusToast(
  status: MapRendererStatus,
  label: string,
  detail: string,
): StatusToastItem | undefined {
  if (status.kind === "ready") return undefined;

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
 * One address, named in place. The human Bond keeps its established slug edit
 * surface; Avaia moves to the full-address profile contract in contract 8.
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

/**
 * A connected provider opens where the domain resolved it: a provider scheme
 * when this host can follow one, the account's own web address when it cannot,
 * and the provider itself when this client does not know that address.
 */
function ProviderMark({
  row,
  label,
}: {
  readonly row: ProviderRowViewState;
  readonly label?: string;
}) {
  if (row.openUrl === undefined) return null;

  return (
    <a
      className={
        label === undefined
          ? "provider-control provider-control--connected"
          : "provider-management__open"
      }
      href={row.openUrl}
      data-open={row.openKind}
      aria-label={row.openLabel}
      title={row.label}
      {...(row.openKind === "deep-link"
        ? {}
        : { target: "_blank", rel: "noreferrer noopener" })}
    >
      {label ?? row.glyph}
    </a>
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
  providerDeepLinks = [],
  onDisconnectProvider,
  avaiaAvailability = "unavailable",
  onPrepareAvaia,
  slugEdit,
  avaiaEdit,
  avatarChoice,
  onAvatarChoice,
  onSlugChange,
  onSlugSubmit,
  onAvaiaChange,
  onAvaiaSubmit,
  onLogout,
  onNavigate,
}: AuthenticatedMapHomeViewProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const location = useDeviceLocation(geolocation);
  const avaiaProfile = useAvaiaProfile(pubDress);
  const [avaiaProfileDraft, setAvaiaProfileDraft] = useState("");
  const [avaiaSaveToast, setAvaiaSaveToast] = useState<
    StatusToastItem | undefined
  >(undefined);
  const [detailState, setDetailState] = useState<
    IdentityDetailState | undefined
  >(undefined);
  const appearance = useAppearance();
  const [mapStatus, setMapStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );
  const [dismissedStatus, setDismissedStatus] = useState<string | undefined>(
    undefined,
  );
  const [wheel, setWheel] = useState<DockSeat>("bond");
  const [dimension, setDimension] = useState<MapDimension>(
    readDimensionPreference,
  );
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
  const resolvedAppearance = appearance.resolved;
  const cameraZoom = camera.zoom;
  const contractVersion = runtimeContract(runtime);
  const mapViewModel = createMapFoundationViewModel(mapStatus);
  const activeDetail =
    detailState?.section === section ? detailState.detail : undefined;
  const dockScreen = activeDetail ?? (section === "world" ? "home" : section);
  const dockDepth =
    activeDetail === undefined ? (section === "world" ? 0 : 1) : section === "world" ? 1 : 2;
  const providers = createBondProvidersViewState(connectedProviders, {
    deepLinkProviders: providerDeepLinks,
  });
  const statusToast = mapStatusToast(
    mapStatus,
    mapViewModel.label,
    mapViewModel.detail,
  );
  const statusToasts = [statusToast, avaiaSaveToast].filter(
    (toast): toast is StatusToastItem =>
      toast !== undefined && toast.id !== dismissedStatus,
  );
  const headerActions: readonly HeaderAction[] =
    onLogout === undefined
      ? []
      : [{ id: "sign-out", label: "Sign out", perform: onLogout }];
  const storedAvaiaPubDress = avaiaProfile.profile?.pubDress ?? avaiaPubDress;
  const avaiaConfiguration = avaiaProfile.profile?.configurationState;
  const avaiaLabel = storedAvaiaPubDress ?? "Avaia";

  useEffect(() => renderer.subscribe(setMapStatus), [renderer]);

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

  useEffect(() => {
    if (mapStatus.kind !== "ready") return;
    location.activate();
  }, [location, mapStatus.kind]);

  useEffect(
    () =>
      renderer.subscribeCamera((change) => {
        setCamera(change.camera);
        if (change.gesture) cameraMovedByPerson.current = true;
      }),
    [renderer],
  );

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
      window.localStorage.setItem(DIMENSION_STORAGE_KEY, dimension);
    } catch {
      // Persistence is best-effort only.
    }
  }, [dimension]);

  function navigate(route: ShellRoute): void {
    onNavigate?.(route);
  }

  function openDetail(detail: IdentityDetail): void {
    setDetailState({ section, detail });
  }

  function openAvaiaDetail(): void {
    if (avaiaConfiguration === undefined || storedAvaiaPubDress === undefined) {
      return;
    }
    avaiaProfile.resetSave();
    setAvaiaProfileDraft(storedAvaiaPubDress);
    openDetail("avaia");
  }

  async function saveAvaiaProfile(): Promise<void> {
    const result = await avaiaProfile.save(avaiaProfileDraft);
    if (result.kind !== "updated") return;

    setAvaiaProfileDraft(result.profile.pubDress);
    setAvaiaSaveToast({
      id: `avaia-saved-${result.profile.pubDress}`,
      kind: "active",
      title: "Avaia saved",
      description: result.profile.pubDress,
    });
    setDetailState(undefined);
    navigate(WORLD_ROUTE);
  }

  const dock = createBondDockViewState({
    pubDress,
    avaiaPubDress: storedAvaiaPubDress,
    wheel,
    avaia: avaiaAvailability,
    avaiaConfiguration,
    focusable: observedPosition !== undefined,
    downloadable: onPrepareAvaia !== undefined,
  });

  useEffect(() => {
    const avatars = renderer.avatars;
    const model = avatarChoice?.rendered;
    if (avatars === undefined || model === undefined) return;
    if (observedPosition === undefined) {
      avatars.remove(AVATAR_HANDLE_ID);
      return;
    }

    const avatarLayer = avatars;
    const renderedModel = model;
    const reducedMotion = prefersReducedMotion();
    function draw(): void {
      const handle = createSelfAvatarHandle({
        pubDress,
        model: renderedModel,
        location: location.state,
        zoom: cameraZoom,
        timeMs: globalThis.performance.now(),
        reducedMotion,
      });
      if (handle !== null) avatarLayer.upsert(handle);
    }

    draw();
    if (reducedMotion) return () => avatarLayer.remove(AVATAR_HANDLE_ID);
    const timer = globalThis.setInterval(draw, AVATAR_AMBIENT_REFRESH_MS);
    return () => {
      globalThis.clearInterval(timer);
      avatarLayer.remove(AVATAR_HANDLE_ID);
    };
  }, [
    avatarChoice?.rendered,
    cameraZoom,
    location.state,
    observedPosition,
    pubDress,
    renderer,
  ]);

  function focusWorldOnWheel(): void {
    if (observedPosition === undefined) return;
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(closeUpCamera(observedPosition, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  function activateSpectator(): void {
    if (dock.handover === "download") {
      onPrepareAvaia?.();
      return;
    }
    if (dock.handover === "switch") {
      setWheel(wheel === "bond" ? "avaia" : "bond");
    }
  }

  function activateLeftSeat(): void {
    if (dock.left.seat === "avaia" && avaiaConfiguration !== undefined) {
      openAvaiaDetail();
      return;
    }
    focusWorldOnWheel();
  }

  function activateRightSeat(): void {
    if (dock.right.seat === "avaia" && avaiaConfiguration !== undefined) {
      openAvaiaDetail();
      return;
    }
    activateSpectator();
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
    if (activeDetail === "avaia") return "Avaia";
    if (section === "settings") return "Application";
    return "Personal Bond";
  }

  function detailTitle(): string {
    if (activeDetail === "avaia") return avaiaLabel;
    if (section === "settings") return "Settings";
    switch (activeDetail) {
      case "providers":
        return "Providers";
      case undefined:
        return pubDress;
      case "avaia":
        return avaiaLabel;
    }
  }

  function dockTitle(): string {
    return section === "world" && activeDetail === undefined
      ? "Bond"
      : detailTitle();
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
          aria-label={dockTitle()}
        >
          <DockWindow screen={dockScreen} depth={dockDepth}>
            {section === "world" && activeDetail === undefined ? (
              <>
                <div className="bond-dock__header">
                  <span className="bond-dock__kicker">Bond</span>
                  <button
                    className="bond-dock__edit"
                    type="button"
                    aria-label="Edit this Bond"
                    onClick={() => navigate(IDENTITY_ROUTE)}
                  >
                    edit <span aria-hidden="true">✍️</span>
                  </button>
                </div>
                <div className="bond-dock__pair">
                  <button
                    className="bond-dock__bond bond-dock__bond--active"
                    type="button"
                    disabled={!dock.left.actionable}
                    onClick={activateLeftSeat}
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
                      dock.right.actionable
                        ? ""
                        : " bond-dock__bond--unavailable"
                    }`}
                    type="button"
                    disabled={!dock.right.actionable}
                    onClick={activateRightSeat}
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
                    <h2>{detailTitle()}</h2>
                  </div>
                </div>

                {activeDetail === "avaia" ? (
                  <AvaiaSetupView
                    address={avaiaLabel}
                    configurationState={avaiaConfiguration}
                    load={avaiaProfile.load}
                    draft={avaiaProfileDraft}
                    saving={avaiaProfile.saving}
                    saveResult={avaiaProfile.saveResult}
                    onDraftChange={(value) => {
                      avaiaProfile.resetSave();
                      setAvaiaProfileDraft(value);
                    }}
                    onSave={() => {
                      void saveAvaiaProfile();
                    }}
                  />
                ) : null}

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
                    {avaiaProfile.load.kind === "unsupported" ? (
                      <AddressField
                        id="avaia-slug"
                        label="avaia"
                        state={avaiaEdit}
                        fallback={avaiaLabel}
                        onChange={onAvaiaChange}
                        onSubmit={onAvaiaSubmit}
                      />
                    ) : (
                      <dl className="bond-profile__rows">
                        <div className="bond-profile__avaia-row">
                          <dt>Avaia</dt>
                          <dd>
                            <button
                              type="button"
                              disabled={avaiaConfiguration === undefined}
                              aria-label={
                                avaiaConfiguration === "unconfigured"
                                  ? `Set up ${avaiaLabel}`
                                  : `Edit ${avaiaLabel}`
                              }
                              onClick={openAvaiaDetail}
                            >
                              {avaiaLabel}
                            </button>
                          </dd>
                        </div>
                      </dl>
                    )}
                    {avatarChoice === undefined ? null : (
                      <fieldset className="avatar-choice">
                        <legend>Avatar</legend>
                        {avatarChoice.options.map((option) => (
                          <label
                            key={option.model}
                            className="interface-settings__option"
                          >
                            <span>
                              <strong>{option.name}</strong>
                              <small>{option.detail}</small>
                            </span>
                            <input
                              type="radio"
                              name="avatar-model"
                              value={option.model}
                              checked={option.selected}
                              disabled={avatarChoice.busy}
                              onChange={() => onAvatarChoice?.(option.model)}
                            />
                          </label>
                        ))}
                        <p className="profile-edit__note">
                          {avatarChoice.unsupportedModel !== undefined
                            ? `This Bond chose ${avatarChoice.unsupportedModel}, which this client cannot display. Update 0x1 to render that choice.`
                            : avatarChoice.unchosen
                              ? "No study chosen yet — no avatar is drawn until you choose."
                              : "The studies share one skeleton and one set of clips; choosing changes the body, not how it moves."}
                        </p>
                        {avatarChoice.error === undefined ? null : (
                          <p className="profile-edit__error" role="alert">
                            {avatarChoice.error}
                          </p>
                        )}
                      </fieldset>
                    )}
                    <dl className="bond-profile__rows">
                      <div>
                        <dt>Providers</dt>
                        <dd>
                          <span className="provider-controls">
                            {providers.connected.map((row) => (
                              <ProviderMark key={row.provider} row={row} />
                            ))}
                            <button
                              className="provider-control provider-control--add"
                              type="button"
                              aria-label="Add a provider"
                              onClick={() => openDetail("providers")}
                            >
                              +
                            </button>
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}

                {section === "settings" && activeDetail === undefined ? (
                  <>
                    <fieldset className="interface-settings__appearance">
                      <legend>Appearance</legend>
                      {(["light", "dark", "auto"] as const).map((mode) => (
                        <label
                          key={mode}
                          className="interface-settings__option"
                        >
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
                            checked={appearance.preference === mode}
                            onChange={() => chooseAppearance(mode)}
                          />
                        </label>
                      ))}
                    </fieldset>
                    <fieldset className="interface-settings__appearance">
                      <legend>Depth</legend>
                      {(["volumetric", "flat"] as const).map((mode) => (
                        <label
                          key={mode}
                          className="interface-settings__option"
                        >
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

                {activeDetail === "providers" ? (
                  <div className="provider-management">
                    <ul className="provider-management__list">
                      {providers.rows.map((row) => (
                        <li key={row.provider} data-connected={row.connected}>
                          <span
                            className={`provider-control${
                              row.connected
                                ? " provider-control--connected"
                                : " provider-control--idle"
                            }`}
                            aria-hidden="true"
                          >
                            {row.glyph}
                          </span>
                          <span>
                            <strong>{row.label}</strong>
                            <small>{row.status}</small>
                          </span>
                          {row.connected ? (
                            <span className="provider-management__actions">
                              <ProviderMark row={row} label="Open" />
                              <button
                                className="provider-management__disconnect"
                                type="button"
                                aria-label={row.disconnectLabel}
                                title={row.disconnectLabel}
                                onClick={() =>
                                  onDisconnectProvider?.(row.provider)
                                }
                              >
                                <span aria-hidden="true">🗑</span>
                              </button>
                            </span>
                          ) : (
                            <a
                              className="provider-management__connect"
                              href={row.connectHref}
                              aria-label={row.connectLabel}
                            >
                              Connect
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="interface-settings__note">
                      A provider account is an identity this Bond points at, one
                      account per provider. Disconnecting detaches it from this
                      Bond; it never deletes the account on the provider.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </DockWindow>
        </section>
      }
      overlay={
        <>
          <LocationControl
            viewModel={locationControl}
            onActivate={activateLocationControl}
          />
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
