// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  createAvaiaMovementController,
  type AvaiaMovementController,
  type BondProviderConnections,
  type BondProviderType,
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
  AVAIA_HANDLE_ID,
  avaiaStandpoint,
  avaiaStudy,
  createAvaiaAvatarHandle,
  headingDegrees,
} from "./avaia-presence";
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
   * The two addresses this Bond may name: its own, and its Avaia's. Without
   * them the profile presents the addresses it already has and offers nothing
   * to change.
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

/** Identity detail is a state of the identity surface, never a separate route. */
type IdentityDetail = "providers";

/**
 * Detail is scoped to the section that opened it, so leaving the identity
 * surface abandons it without a state synchronisation effect.
 */
interface IdentityDetailState {
  readonly section: ShellSection;
  readonly detail: IdentityDetail;
}
/** One ambient slot: the cadence the sampler itself changes clips on. */
const AVATAR_AMBIENT_REFRESH_MS = 8_000;

const DIMENSION_STORAGE_KEY = "nilx-one.interface.dimension";

/** Long enough that any standoff is already behind the body that skipped it. */
const REDUCED_MOTION_ARRIVAL_SECONDS = 3_600;

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

/**
 * A connected provider opens where the domain resolved it: a provider scheme
 * when this host can follow one, the account's own web address when it cannot,
 * and the provider itself when this client does not know that address. The
 * mark carries no account text — the provider is what it says.
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
      // A provider scheme is handed to the platform in place; only a web
      // address is worth a second browsing context.
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
  // Who is at the wheel is presentation: it moves nothing in the shared world.
  const [wheel, setWheel] = useState<DockSeat>("bond");
  const [dimension, setDimension] = useState<MapDimension>(
    readDimensionPreference,
  );
  // The camera the renderer actually holds, and whether a person put it there.
  const [camera, setCamera] = useState(() => renderer.getCamera());
  const cameraMovedByPerson = useRef(false);
  // The Avaia keeps walking across renders, so its movement and the way it
  // ended up facing outlive any one of them.
  const avaiaMovement = useRef<AvaiaMovementController | undefined>(undefined);
  const avaiaFacing = useRef(0);
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
  // Zoom alone drives the body's apparent size, so the avatar is not redrawn
  // for a pan that leaves the scale untouched.
  const cameraZoom = camera.zoom;
  // Whether anything will stand here at close range. Without a body the marker
  // keeps representing the person at every scale rather than fading into
  // nothing on the way in.
  const bodyDrawn =
    renderer.avatars !== undefined &&
    avatarChoice?.rendered !== undefined &&
    observedPosition !== undefined;
  const contractVersion = runtimeContract(runtime);
  const mapViewModel = createMapFoundationViewModel(mapStatus);
  const activeDetail =
    detailState?.section === section ? detailState.detail : undefined;
  const dockScreen = section === "world" ? "home" : (activeDetail ?? section);
  // The Dock's navigation stack: the world, a Bond surface, a screen it opens.
  const dockDepth =
    section === "world" ? 0 : activeDetail === undefined ? 1 : 2;
  const providers = createBondProvidersViewState(connectedProviders, {
    deepLinkProviders: providerDeepLinks,
  });
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
  // One address seeds this Avaia's body, its side of its Bond, and its rhythm,
  // so an unnamed Avaia is still the same Avaia between renders.
  const avaiaAddress = avaiaLabel;

  // A map that never paints must say so. Without this the shell shows an empty
  // surface and a renderer, asset, or basemap failure is indistinguishable
  // from an ordinary dark map.
  useEffect(() => renderer.subscribe(setMapStatus), [renderer]);

  // The marker and the body are one representation, not two: the point stands
  // for the person until a body can, and hands over when it does.
  useEffect(() => {
    renderer.setObservedPositionRole(bodyDrawn ? "body" : "person");
  }, [bodyDrawn, renderer]);

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
  // The Bond's own body stands where this device observed itself, and only
  // after the Bond chose a study this client can render. The ambient clip is
  // resampled on the slot boundary rather than per frame: the renderer owns
  // playback, this owns the choice of clip. The camera's zoom reaches the body
  // as apparent size only — it is what lets a person be seen at all when the
  // ground under them is still far away, and it moves nobody.
  useEffect(() => {
    const avatars = renderer.avatars;
    const model = avatarChoice?.rendered;
    if (avatars === undefined || model === undefined) return;
    if (observedPosition === undefined) {
      avatars.remove(AVATAR_HANDLE_ID);
      return;
    }

    // Capture the narrowed capability and published model before the timer
    // closure. TypeScript correctly treats these aliases as stable values, and
    // the effect still exits before drawing when either capability is absent.
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

  // The Avaia's own body, walking.
  //
  // An Avaia is this Bond's AI counterpart, so where it stands is local
  // presentation the client composes for itself — never a shared-world fact
  // and never written back. It accompanies its Bond, and a new observation is
  // somewhere to walk to rather than somewhere to appear: the controller moves
  // it at walking pace, and the body plays its walk while it is going.
  useEffect(() => {
    const avatars = renderer.avatars;
    const bondStudy = avatarChoice?.rendered;
    if (avatars === undefined) return;
    // A body needs a study to wear, and an Avaia never wears its Bond's own —
    // so the Bond's choice is what tells this one which body is left.
    if (
      bondStudy === undefined ||
      avaiaAvailability !== "ready" ||
      observedPosition === undefined
    ) {
      avatars.remove(AVAIA_HANDLE_ID);
      avaiaMovement.current = undefined;
      return;
    }

    const avatarLayer = avatars;
    const address = avaiaAddress;
    const study = avaiaStudy(address, bondStudy);
    const reducedMotion = prefersReducedMotion();
    const standpoint = avaiaStandpoint(
      {
        longitude: observedPosition.longitude,
        latitude: observedPosition.latitude,
      },
      address,
    );

    const controller =
      avaiaMovement.current ??
      createAvaiaMovementController({ initialPosition: standpoint });
    avaiaMovement.current = controller;
    controller.navigateTo(standpoint);
    // Reduced motion asks for no journey, not for no Avaia: it arrives at the
    // same place, without the walk between here and there.
    if (reducedMotion) controller.tick(REDUCED_MOTION_ARRIVAL_SECONDS);

    let frame: number | undefined;
    let lastMs = globalThis.performance.now();

    function draw(nowMs: number): void {
      const movement = controller.tick(Math.max(0, (nowMs - lastMs) / 1_000));
      lastMs = nowMs;
      if (movement.kind === "moving") {
        avaiaFacing.current = headingDegrees(
          movement.position,
          movement.target,
        );
      }

      avatarLayer.upsert(
        createAvaiaAvatarHandle({
          avaiaAddress: address,
          study,
          movement,
          zoom: cameraZoom,
          timeMs: nowMs,
          reducedMotion,
          facingDegrees: avaiaFacing.current,
        }),
      );

      // The walk is the only thing that needs a frame. Standing still, this
      // body resamples on the ambient slot like every other one.
      frame =
        movement.kind === "moving"
          ? globalThis.requestAnimationFrame(draw)
          : undefined;
    }

    draw(lastMs);
    const ambient = globalThis.setInterval(
      () => draw(globalThis.performance.now()),
      AVATAR_AMBIENT_REFRESH_MS,
    );

    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      globalThis.clearInterval(ambient);
      avatarLayer.remove(AVAIA_HANDLE_ID);
    };
  }, [
    avaiaAddress,
    avaiaAvailability,
    avatarChoice?.rendered,
    cameraZoom,
    observedPosition,
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
      case "providers":
        return "Providers";
      case undefined:
        return pubDress;
    }
  }

  /** The Dock names itself by the screen it is presenting. */
  function dockTitle(): string {
    return section === "world" ? "Bond" : detailTitle();
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
            {section === "world" ? (
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
                      dock.right.actionable
                        ? ""
                        : " bond-dock__bond--unavailable"
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
                    <h2>{detailTitle()}</h2>
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

                {section === "settings" ? (
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
