// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_CATALOG,
  type AvaiaProfileUpdateResult,
  type AvatarModelResult,
  type AvatarSelection,
  type BondProviderConnections,
  type BondProviderType,
} from "@nilx-one/application";
import type { GeolocationCapability } from "@nilx-one/host-contract";
import {
  avatarPreviewUrl,
  mapDistanceMeters,
  type AvatarModelId,
  type MapDimension,
  type MapObservedPositionLabel,
  type MapPointSelection,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import { StatusToastStack, type StatusToastItem } from "@nilx-one/ui";
import { useEffect, useRef, useState } from "react";

import { AppHeader, type HeaderAction } from "../../shell/app-header";
import { AppShell, type ShellSafeArea } from "../../shell/app-shell";
import { chooseAppearance, useAppearance } from "../../shell/appearance";
import { DockWindow } from "../../shell/dock-window";
import { LanguageSettings } from "../../shell/language-settings";
import {
  translate,
  useLocalization,
  type ProductLocale,
} from "../../shell/localization";
import type { LocalModelDependency } from "../../shell/local-model-host";
import { LocalModelSettings } from "../../shell/local-model-settings";
import {
  IDENTITY_ROUTE,
  WORLD_ROUTE,
  type ShellRoute,
  type ShellSection,
} from "../../shell/routes";
import { prefersReducedMotion } from "../../shell/motion";
import { useShellPresentation } from "../../shell/shell-presentation";
import type { RuntimeViewState } from "../identity/identity-foundation-view-model";
import type { AvatarChoiceViewState } from "../identity/avatar-choice-view-model";
import { AvatarEditorView } from "../identity/avatar-editor-view";
import {
  chooseDraftModel,
  createAvatarEditorViewState,
  createAvatarFieldViewState,
  draftFromSelection,
  draftSelection,
  equipInDraft,
  type AvatarDraft,
  type AvatarSubject,
} from "../identity/avatar-editor-view-model";
import { AvatarModelField } from "../identity/avatar-model-field";
import {
  useAvatarSelection,
  useCommitAvatarSelection,
} from "../identity/use-avatar-selection";
import {
  createBondProvidersViewState,
  type ProviderRowViewState,
} from "../identity/bond-providers-view-model";
import type { AddressSlugViewState } from "../identity/profile-slug-view-model";
import "./authenticated-map-home-view.css";
import "./authenticated-map-settings.css";
import "../identity/avatar-editor.css";
// Hidden for now; see the commented render call in Settings below.
// import { BondArtificialPositionSettings } from "./bond-artificial-position-settings";
import {
  deviceLocationPosition,
  type DeviceLocationState,
} from "./device-location";
import { LocationControl } from "./location-control";
import { useDeviceLocation } from "./use-device-location";
import { createLocationControlViewModel } from "./location-control-view-model";
import {
  bodyVisibleCamera,
  cameraFramesPosition,
  cameraMotion,
  closeUpCamera,
  firstFixCamera,
  locationCameraPadding,
  recenterCamera,
} from "./location-camera-policy";
import { createMapFoundationViewModel } from "./map-foundation-view-model";
import {
  avaiaStudy,
  BODY_HANDLE_IDS,
  createWheelBodyHandle,
} from "./avatar-presence";

import {
  handoverComplete,
  HANDOVER_MS,
  wheelBody,
  type WheelHandover,
} from "./wheel-handover";
import {
  createBondDockViewState,
  type AvaiaAvailability,
  type DockSeat,
} from "./bond-dock-view-model";
import { landmarkLabel } from "./avaia-lines";
import { studiedBy } from "./landmark-notebook";
import { pinnedLandmarks } from "./pinned-landmarks";
import { useAvaiaWalk } from "./use-avaia-walk";
import { FogRevealPrompt } from "./fog-reveal-prompt";
import { useFogReveal, type FogRevealState } from "./use-fog-reveal";
import { AvaiaSetupView } from "../avaia/avaia-setup-view";
import type { AvaiaSetupViewState } from "../avaia/avaia-setup-view-model";

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
   * The on-device model host, when this deployment has wired one. Undefined is a normal,
   * honest state — Settings then simply has nothing to show here — not a degraded one.
   */
  readonly localModel?: LocalModelDependency;
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
   * The Bond address may be renamed here. Its owned Avaia is edited only on
   * the dedicated Owned Avaia surface, so this profile has one address editor.
   */
  readonly slugEdit?: AddressSlugViewState;
  /**
   * The Avaia this Bond owns, as identity contract 8 keeps it. Without it the
   * Dock knows of no stored configuration and stays a runtime-only Dock.
   */
  readonly avaiaSetup?: AvaiaSetupViewState;
  readonly onAvaiaSetupChange?: (pubDress: string) => void;
  /**
   * Saves the whole address and answers with what the service stored. The
   * answer is what closes the screen, so a return to the world is never a guess
   * about a request that may still be in flight.
   */
  readonly onAvaiaSetupSubmit?: () => Promise<
    AvaiaProfileUpdateResult | undefined
  >;
  /** The body this Bond is represented by, and the studies it may choose. */
  readonly avatarChoice?: AvatarChoiceViewState;
  /**
   * Choose the body this Bond is represented by. It answers with what the
   * service said, because the editor cannot commit an outfit for a body the
   * service refused — a half-saved body is not what anyone asked for.
   */
  readonly onAvatarChoice?: (
    model: AvatarChoiceViewState["options"][number]["model"],
  ) => Promise<AvatarModelResult | undefined>;
  readonly onSlugChange?: (slug: string) => void;
  readonly onSlugSubmit?: () => void;
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

/** Identity detail is a state of the Dock's own stack, never a separate route. */
type IdentityDetail = "providers" | "avaia" | "avatar";

/**
 * Detail is scoped to the section that opened it, so leaving the identity
 * surface abandons it without a state synchronisation effect.
 */
interface IdentityDetailState {
  readonly section: ShellSection;
  readonly detail: IdentityDetail;
  /**
   * Whose body the avatar editor was opened for, which is also where Back
   * returns to: an editor reached from an Avaia goes back to that Avaia.
   */
  readonly subject?: AvatarSubject;
}
/** One ambient slot: the cadence the sampler itself changes clips on. */
const AVATAR_AMBIENT_REFRESH_MS = 8_000;

const DIMENSION_STORAGE_KEY = "nilx-one.interface.dimension";

/** Closer than this, a body is still standing at this device. */
const AT_DEVICE_METERS = 5;

/**
 * Past this many pixels of scroll, a Dock detail's large title has scrolled
 * far enough out of the way that the sticky header needs to start saying
 * its name.
 */
const DETAIL_TITLE_COLLAPSE_PX = 24;

function formatDistance(locale: ProductLocale, meters: number): string {
  const kilometres = meters >= 1_000;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: kilometres ? "kilometer" : "meter",
    unitDisplay: "short",
    maximumFractionDigits: kilometres ? 1 : 0,
  }).format(kilometres ? meters / 1_000 : meters);
}

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
  localModel,
  connectedProviders,
  providerDeepLinks = [],
  onDisconnectProvider,
  avaiaAvailability = "unavailable",
  onPrepareAvaia,
  slugEdit,
  avaiaSetup,
  onAvaiaSetupChange,
  onAvaiaSetupSubmit,
  avatarChoice,
  onAvatarChoice,
  onSlugChange,
  onSlugSubmit,
  onLogout,
  onNavigate,
}: AuthenticatedMapHomeViewProps) {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLElement>(null);
  const renderedDetailScreenKey = useRef<string | undefined>(undefined);
  const location = useDeviceLocation(geolocation);
  const [detailState, setDetailState] = useState<
    IdentityDetailState | undefined
  >(undefined);
  // A Dock detail's own name is its large title, at the top of the screen it
  // names — the same place iOS puts one — until scrolling carries it out of
  // view, at which point the sticky header's small title takes over saying
  // it. The two are one name in two states, never both said at once.
  const [detailTitleCollapsed, setDetailTitleCollapsed] = useState(false);
  const appearance = useAppearance();
  const [mapStatus, setMapStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );
  const [dismissedStatus, setDismissedStatus] = useState<string | undefined>(
    undefined,
  );
  // What the service stored, said once where every transient notice is said.
  // It is not dismissed on a timer: a person closes it when they have read it.
  const [avaiaSavedToast, setAvaiaSavedToast] = useState<
    StatusToastItem | undefined
  >(undefined);
  // Who is at the wheel is presentation: it moves nothing in the shared world.
  // The authenticated world opens on the Avaia, with its Bond spectating: the
  // first thing a person sees is the character they point around the world,
  // and taking the wheel back is one tap on the Dock.
  const [wheel, setWheel] = useState<DockSeat>("avaia");
  const [handover, setHandover] = useState<WheelHandover | undefined>(
    undefined,
  );
  const [dimension, setDimension] = useState<MapDimension>(
    readDimensionPreference,
  );
  // The camera the renderer actually holds, and whether a person put it there.
  const [camera, setCamera] = useState(() => renderer.getCamera());
  const cameraMovedByPerson = useRef(false);
  const reachForBody = useRef<() => void>(() => undefined);
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
  const contractVersion = runtimeContract(runtime);
  const mapViewModel = createMapFoundationViewModel(mapStatus);
  const activeDetail =
    detailState?.section === section ? detailState.detail : undefined;
  const dockScreen = activeDetail ?? (section === "world" ? "home" : section);
  // The Dock's navigation stack: the world, a Bond surface, a screen it opens.
  const dockDepth =
    (section === "world" ? 0 : 1) + (activeDetail === undefined ? 0 : 1);
  const providers =
    connectedProviders === undefined
      ? undefined
      : createBondProvidersViewState(connectedProviders, {
          deepLinkProviders: providerDeepLinks,
        });
  const statusToast = mapStatusToast(
    mapStatus,
    mapViewModel.label,
    mapViewModel.detail,
  );
  const statusToasts = [
    ...(statusToast === undefined || statusToast.id === dismissedStatus
      ? []
      : [statusToast]),
    ...(avaiaSavedToast === undefined ? [] : [avaiaSavedToast]),
  ];
  const headerActions: readonly HeaderAction[] =
    onLogout === undefined
      ? []
      : [{ id: "sign-out", label: "Sign out", perform: onLogout }];
  // The stored address the service answered with outranks the projection this
  // client last carried; both are the same identity, only one is newer.
  const storedAvaiaPubDress =
    avaiaSetup !== undefined && avaiaSetup.address.length > 0
      ? avaiaSetup.address
      : avaiaPubDress;
  const avaiaLabel = storedAvaiaPubDress ?? "Avaia";
  // One address seeds this Avaia's body, its side of its Bond, and its rhythm,
  // so an unnamed Avaia is still the same Avaia between renders.
  const avaiaAddress = avaiaLabel;

  const [avatarDraft, setAvatarDraft] = useState<AvatarDraft | undefined>(
    undefined,
  );
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarError, setAvatarError] = useState<string | undefined>(undefined);
  const commitAvatar = useCommitAvatarSelection();
  // The body a Bond chose is the service's; what it wears is this device's.
  // Reading them together in one place keeps the two halves from being
  // resolved differently on different screens.
  const bondAvatar = useAvatarSelection(pubDress, avatarChoice?.rendered);
  const avaiaAvatar = useAvatarSelection(
    avaiaAddress,
    bondAvatar === undefined
      ? undefined
      : avaiaStudy(avaiaAddress, bondAvatar.modelId),
  );

  // The study of whoever is at the wheel: the body on the world, and the still
  // the label falls back to once that body is too far away to read. Reads
  // through bondAvatar/avaiaAvatar rather than recomputing the ambient study
  // directly, so a body either identity actually chose is what is shown —
  // avaiaAvatar already is that ambient study whenever nothing was chosen.
  const wheelStudy =
    wheel === "bond" ? bondAvatar?.modelId : avaiaAvatar?.modelId;
  // The card names whoever is driving, not the Bond regardless of the wheel —
  // the observation is drawn at this device's own position either way, but
  // the identity standing there changes hands with the wheel.
  const wheelAddress = wheel === "bond" ? pubDress : avaiaAddress;
  const { t, resolved: locale } = useLocalization();
  // The study the Avaia is drawn in, whose voice it speaks in. No body drawn
  // means no voice either: a card does not talk on behalf of nobody.
  const avaiaVoice: AvatarModelId | undefined = avaiaAvatar?.modelId as
    AvatarModelId | undefined;
  // A declared point stands the Bond somewhere; only a real observation says
  // this device is anywhere.
  const declaredPosition = observedPosition?.declared === true;
  const deviceObservation = declaredPosition ? undefined : observedPosition;
  // The Avaia answers fog taps through the reveal below, which in turn talks
  // in the Avaia's voice: the ref is what lets the two hooks meet.
  const fogRevealRef = useRef<FogRevealState | undefined>(undefined);
  const avaiaWalk = useAvaiaWalk({
    renderer,
    active: wheel === "avaia" && handover === undefined,
    observed: observedPosition,
    model: avaiaVoice,
    locale,
    avaiaAddress,
    owner: pubDress,
    zoom: camera.zoom,
    reducedMotion: prefersReducedMotion(),
    onFogTap: (point) => {
      const outcome = fogRevealRef.current?.handleFogTap(point);
      if (outcome === "busy") return "busy";
      return outcome === "offered" || outcome === "revealing";
    },
  });
  const [fogAnnouncement, setFogAnnouncement] = useState("");
  const fogReveal = useFogReveal({
    renderer,
    bondPoint: observedPosition,
    observed: deviceObservation,
    owner: pubDress,
    onRevealed: (_cell, via) => {
      setFogAnnouncement(t("fog.announce.revealed"));
      if (via === "avaia" && wheel === "avaia" && handover === undefined) {
        avaiaWalk.announce("fog.revealed");
      }
    },
  });
  useEffect(() => {
    fogRevealRef.current = fogReveal;
  });
  // Opening a Dock screen turns the person's attention away from the world
  // the prompt floats over; whatever it was asking is no longer being
  // answered.
  useEffect(() => {
    fogRevealRef.current?.dismiss();
  }, [activeDetail]);
  // A screen just opened reads from its own top, its large title showing —
  // never scrolled to wherever the screen before it was left.
  const detailScreenKey = `${section}:${activeDetail ?? ""}`;
  if (detailScreenKey !== renderedDetailScreenKey.current) {
    renderedDetailScreenKey.current = detailScreenKey;
    if (detailTitleCollapsed) setDetailTitleCollapsed(false);
  }
  useEffect(() => {
    if (dockRef.current !== null) dockRef.current.scrollTop = 0;
  }, [activeDetail, section]);
  const avaiaSpeech =
    wheel === "avaia" && handover === undefined
      ? avaiaWalk.speech?.text
      : undefined;
  const avaiaStudied = studiedBy(avaiaWalk.notebook, avaiaAddress);

  /**
   * The card over whoever is at the wheel. It stands over the body — which for
   * an Avaia that walked off is not this device — and says how far from this
   * device that is, so the card never claims a position it does not have.
   */
  function wheelLabel(
    at: MapPointSelection | undefined,
  ): MapObservedPositionLabel {
    const away =
      at !== undefined && observedPosition !== undefined
        ? mapDistanceMeters(observedPosition, at)
        : 0;
    return {
      title: wheelAddress,
      detail:
        away > AT_DEVICE_METERS
          ? t(
              declaredPosition
                ? "map.card.fromDeclared"
                : "map.card.fromThisDevice",
            ).replace("{distance}", formatDistance(locale, away))
          : t(declaredPosition ? "map.card.declared" : "map.card.thisDevice"),
      ...(at === undefined || away <= AT_DEVICE_METERS
        ? {}
        : { at: [at.longitude, at.latitude] as const }),
      ...(avaiaSpeech === undefined ? {} : { speech: avaiaSpeech }),
      // Too far out for a body, so the card shows the study it would be
      // standing in — the same identity, at a size that survives the distance.
      ...(wheelStudy === undefined
        ? {}
        : { avatarUrl: avatarPreviewUrl(wheelStudy) }),
    };
  }
  const wheelLabelRef = useRef(wheelLabel);
  useEffect(() => {
    wheelLabelRef.current = wheelLabel;
  });

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

  // Pinned landmarks are fixed geography with localized names: they follow the
  // locale, nothing else, and clear with the world that drew them.
  useEffect(() => {
    renderer.setPinnedLandmarks?.(
      pinnedLandmarks((key) => translate(locale, key)),
    );
  }, [renderer, locale]);
  useEffect(() => () => renderer.setPinnedLandmarks?.([]), [renderer]);

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
          // A person who is looking elsewhere is not answering the prompt.
          fogRevealRef.current?.dismiss();
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
    const stance =
      wheel === "avaia" && handover === undefined
        ? avaiaWalk.stance(globalThis.performance.now())
        : undefined;
    renderer.setObservedPositionLabel(wheelLabelRef.current(stance?.point));
  }, [
    avaiaSpeech,
    avaiaWalk,
    handover,
    locale,
    observedPosition,
    renderer,
    wheel,
    wheelAddress,
    wheelStudy,
  ]);

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

  function openDetail(detail: IdentityDetail, subject?: AvatarSubject): void {
    setDetailState({
      section,
      detail,
      ...(subject === undefined ? {} : { subject }),
    });
  }

  /**
   * Open the body a subject is represented by, with a draft that starts as
   * exactly what is saved. Nothing in the editor is persisted until Save, so
   * the draft is discarded whenever the editor is left.
   */
  function openAvatarEditor(subject: AvatarSubject): void {
    const selection = subject === "bond" ? bondAvatar : avaiaAvatar;
    // An identity that has chosen nothing still needs a way in. The editor
    // opens on the first published study with nothing saved behind it, so the
    // first choice is already something to save.
    setAvatarDraft(
      draftFromSelection(
        selection ?? {
          modelId: AVATAR_CATALOG[0]?.id ?? "sky-study",
          appearance: {},
        },
      ),
    );
    setAvatarError(undefined);
    openDetail("avatar", subject);
  }

  function closeAvatarEditor(): void {
    const returnTo = detailState?.subject === "avaia" ? "avaia" : undefined;
    setAvatarDraft(undefined);
    setAvatarError(undefined);
    setDetailState(
      returnTo === undefined ? undefined : { section, detail: returnTo },
    );
  }

  /**
   * Commit a draft.
   *
   * The body a Bond chose is identity state, so it goes to the service and the
   * outcome is what the editor reports. What that body wears is this device's
   * and is written here. A model the service refuses leaves the outfit
   * unwritten too: a half-saved body is not what a person asked for.
   */
  async function saveAvatarDraft(): Promise<void> {
    const subject = detailState?.subject ?? "bond";
    if (avatarDraft === undefined) return;
    const persisted = subject === "bond" ? bondAvatar : avaiaAvatar;
    const selection = draftSelection(avatarDraft);
    const address = subject === "bond" ? pubDress : avaiaAddress;

    if (
      subject === "bond" &&
      selection.modelId !== persisted?.modelId &&
      onAvatarChoice !== undefined
    ) {
      setAvatarSaving(true);
      const outcome = await onAvatarChoice(selection.modelId);
      setAvatarSaving(false);
      if (outcome?.kind !== "chosen") {
        setAvatarError(
          avatarChoice?.error ?? "Couldn’t save this choice. Try again.",
        );
        return;
      }
    }

    commitAvatar({
      subject,
      address,
      selection,
      modelIsLocal: subject !== "bond",
    });
    closeAvatarEditor();
  }

  /**
   * The one explicit user-gesture path. It either asks the host — which is
   * also the retry when a platform refuses to prompt without a gesture — or
   * moves the camera back onto the latest observation. It never refetches a
   * position it already has.
   */
  const dock = createBondDockViewState({
    pubDress,
    avaiaPubDress: storedAvaiaPubDress,
    wheel,
    avaia: avaiaAvailability,
    ...(avaiaSetup?.configuration === undefined
      ? {}
      : { avaiaConfiguration: avaiaSetup.configuration }),
    focusable: observedPosition !== undefined,
    downloadable: onPrepareAvaia !== undefined,
  });

  /**
   * The identity at the wheel is where the world looks. Focusing it is a camera
   * move to the closest scale this policy allows, never a claim of presence.
   */
  // The body of whichever identity is at the wheel.
  //
  // The world draws one: the Dock says who is driving, and this is that
  // identity standing on the world. Where it stands is the one thing this
  // client observed — its own device position. Handing the wheel over is a
  // body settling and leaving, then the other arriving, so a handover holds
  // both handles for as long as it runs and the arriving study can load while
  // the other one is still going.
  useEffect(() => {
    const avatars = renderer.avatars;
    const bondStudy = avatarChoice?.rendered;
    if (avatars === undefined || bondStudy === undefined) return;
    if (observedPosition === undefined) {
      for (const id of Object.values(BODY_HANDLE_IDS)) avatars.remove(id);
      return;
    }

    const avatarLayer = avatars;
    const reducedMotion = prefersReducedMotion();
    // The world draws whatever body was actually chosen for each identity —
    // avaiaAvatar already falls back to the ambient study on its own when
    // nothing was, so there is no separate raw computation to keep in step
    // with it.
    const study = (seat: DockSeat) =>
      seat === "bond" ? bondStudy : (avaiaAvatar?.modelId ?? bondStudy);
    const address = (seat: DockSeat) =>
      seat === "bond" ? pubDress : avaiaAddress;
    // What each identity is wearing, resolved exactly once and drawn by the
    // world the same way the settings preview and the editor draw it.
    const worn = (seat: DockSeat) =>
      seat === "bond" ? bondAvatar?.appearance : avaiaAvatar?.appearance;

    let frame: number | undefined;

    function draw(nowMs: number): void {
      const body = wheelBody(wheel, handover, nowMs);
      const stance =
        body.seat === "avaia" && handover === undefined
          ? avaiaWalk.stance(nowMs)
          : undefined;
      const handle = createWheelBodyHandle({
        body,
        address: address(body.seat),
        study: study(body.seat),
        appearance: worn(body.seat),
        location: location.state,
        zoom: cameraZoom,
        timeMs: nowMs,
        reducedMotion,
        stance,
      });
      if (handle !== null) avatarLayer.upsert(handle);
      // A walking body carries its card with it, frame by frame.
      if (avaiaWalk.moving && stance !== undefined) {
        renderer.setObservedPositionLabel(wheelLabelRef.current(stance.point));
      }

      // Only the identity in the seat this instant is on the world: the other
      // handle is dropped rather than left standing behind the one driving.
      for (const [seat, id] of Object.entries(BODY_HANDLE_IDS)) {
        if (seat !== body.seat) avatarLayer.remove(id);
      }

      // A handover and a walk are the only things here that need frames, and
      // both end.
      frame =
        (handover !== undefined && !handoverComplete(handover, nowMs)) ||
        (handover === undefined && avaiaWalk.moving)
          ? globalThis.requestAnimationFrame(draw)
          : undefined;
    }

    draw(globalThis.performance.now());
    const ambient = globalThis.setInterval(
      () => draw(globalThis.performance.now()),
      AVATAR_AMBIENT_REFRESH_MS,
    );

    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame(frame);
      globalThis.clearInterval(ambient);
      for (const id of Object.values(BODY_HANDLE_IDS)) avatarLayer.remove(id);
    };
  }, [
    avaiaAddress,
    avaiaAvatar?.appearance,
    avaiaAvatar?.modelId,
    avatarChoice?.rendered,
    avaiaWalk,
    bondAvatar?.appearance,
    cameraZoom,
    handover,
    location.state,
    observedPosition,
    pubDress,
    renderer,
    wheel,
  ]);

  /**
   * A body on the world answers for itself.
   *
   * Reaching for it means the same thing as reaching for the card of whoever is
   * driving — bring the world to them — and it also puts the Dock back on the
   * pair, because that is the screen a body belongs to. A renderer that draws
   * no bodies, or draws them where nothing can be pointed at, publishes no
   * activation and this simply never runs: the Dock offers both outcomes to a
   * keyboard regardless.
   */
  useEffect(() => {
    // What the camera would move to depends on where this device is and on the
    // shell it is drawn in, and both change under a subscription that should
    // not be torn down and rebuilt for either. The renderer keeps one listener;
    // this keeps it pointed at the current answer.
    reachForBody.current = () => {
      setDetailState(undefined);
      if (section !== "world") navigate(WORLD_ROUTE);
      focusWorldOnWheel();
    };
  });

  // With the Bond at the wheel nobody walks, but reachable fog still answers
  // a tap: the Avaia does the revealing either way.
  useEffect(() => {
    if (wheel !== "bond") return;
    const subscribe = renderer.subscribeGroundTap;
    if (subscribe === undefined) return;
    return subscribe.call(renderer, (tap) => {
      if (tap.ground === "fog") fogRevealRef.current?.handleFogTap(tap);
    });
  }, [renderer, wheel]);

  useEffect(() => {
    const subscribe = renderer.subscribeBodyActivation;
    if (subscribe === undefined) return;

    return subscribe.call(renderer, () => reachForBody.current());
  }, [renderer]);

  // A handover ends on its own: the wheel is already where it is going, and
  // clearing it is what returns the arrived body to the ambient rhythm.
  useEffect(() => {
    if (handover === undefined) return;
    const remaining = Math.max(
      0,
      handover.startedMs + HANDOVER_MS - globalThis.performance.now(),
    );
    const settled = globalThis.setTimeout(
      () => setHandover(undefined),
      remaining,
    );
    return () => globalThis.clearTimeout(settled);
  }, [handover]);

  function focusWorldOnWheel(): void {
    if (observedPosition === undefined) return;
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(closeUpCamera(observedPosition, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  /**
   * The pair has two meanings, one per side. The identity at the wheel brings
   * the world to it; the one spectating takes the wheel from it.
   */
  function activateDockIdentity(seated: "left" | "right"): void {
    if (seated === "left") {
      focusWorldOnWheel();
      return;
    }
    activateSpectator();
  }

  /** The Dock's own action configures whoever is currently driving. */
  function activateConfigure(): void {
    if (dock.configure.seat === "avaia") {
      openDetail("avaia");
      return;
    }
    navigate(IDENTITY_ROUTE);
  }

  /**
   * A save ends on the world. The service answers with what it stored, that
   * answer is what the surface already reads, and only then does the screen
   * close — so nothing here confirms a draft the service never saw. The world
   * underneath was never a screen to come back to; it stayed mounted.
   */
  async function submitAvaiaSetup(): Promise<void> {
    const result = await onAvaiaSetupSubmit?.();
    if (result?.kind !== "updated") return;
    setDetailState(undefined);
    setAvaiaSavedToast({
      id: `avaia-saved:${result.profile.pubDress}`,
      kind: "active",
      title: "Avaia saved",
      description: result.profile.pubDress,
    });
  }

  /**
   * The identity that is spectating takes the wheel.
   *
   * It is not a swap at one instant: the body driving settles and leaves, and
   * the one taking over arrives on the world — so the camera comes in far
   * enough for that to be something a person can watch happen. A device that
   * could fetch the runtime is asked for it here too: taking the wheel is one
   * gesture, and what a device fetches to serve it is not a second decision.
   */
  function activateSpectator(): void {
    if (dock.preparesRuntime) onPrepareAvaia?.();

    const to: DockSeat = wheel === "bond" ? "avaia" : "bond";
    // An Avaia taking the wheel starts from where its owner is; one leaving it
    // stops wherever it was going. Neither walks on in the background.
    avaiaWalk.reset();
    setHandover({ from: wheel, to, startedMs: globalThis.performance.now() });
    setWheel(to);

    if (observedPosition === undefined) return;
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(bodyVisibleCamera(observedPosition, camera, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  /** The Bond said yes: the Avaia goes to the cell and starts on it. */
  function confirmFogReveal(): void {
    const job = fogReveal.confirm();
    if (job === undefined) return;
    if (wheel === "avaia" && handover === undefined) {
      avaiaWalk.walkTo(job.cell.center);
      avaiaWalk.announce("fog.reveal");
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
    if (activeDetail === "avatar") {
      // Leaving the editor is the same as cancelling it: a draft that was
      // never saved does not survive the way out.
      closeAvatarEditor();
      return;
    }
    setDetailState(undefined);
  }

  function detailEyebrow(): string {
    if (activeDetail === "avatar") {
      return detailState?.subject === "avaia" ? avaiaLabel : pubDress;
    }
    if (activeDetail === "avaia") return "Owned Avaia";
    if (section === "settings") return "Application";
    return "Personal Bond";
  }

  function detailTitle(): string {
    switch (activeDetail) {
      case "providers":
        return "Providers";
      case "avatar":
        return "3D model";
      case "avaia":
        return avaiaLabel;
      case undefined:
        return section === "settings" ? "Settings" : pubDress;
    }
  }

  /** The Dock names itself by the screen it is presenting. */
  function dockTitle(): string {
    return section === "world" ? "Bond" : detailTitle();
  }

  function handleDockScroll(): void {
    const collapsed =
      (dockRef.current?.scrollTop ?? 0) > DETAIL_TITLE_COLLAPSE_PX;
    setDetailTitleCollapsed((current) =>
      current === collapsed ? current : collapsed,
    );
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
          onDismiss={(id) => {
            if (avaiaSavedToast?.id === id) {
              setAvaiaSavedToast(undefined);
              return;
            }
            setDismissedStatus(id);
          }}
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
          ref={dockRef}
          onScroll={
            activeDetail === undefined && section === "world"
              ? undefined
              : handleDockScroll
          }
        >
          <DockWindow screen={dockScreen} depth={dockDepth}>
            {section === "world" && activeDetail === undefined ? (
              <>
                <div className="bond-dock__header">
                  <span className="bond-dock__kicker">Bond</span>
                  <button
                    className="bond-dock__edit"
                    type="button"
                    aria-label={dock.configure.label}
                    onClick={activateConfigure}
                  >
                    edit
                  </button>
                </div>
                <div className="bond-dock__pair">
                  <button
                    className="bond-dock__bond bond-dock__bond--active"
                    type="button"
                    disabled={!dock.left.actionable}
                    onClick={() => activateDockIdentity("left")}
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
                    onClick={() => activateDockIdentity("right")}
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
                <div
                  className="bond-dock__detail-header"
                  data-collapsed={detailTitleCollapsed}
                >
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
                    <h2 aria-hidden={!detailTitleCollapsed}>{detailTitle()}</h2>
                  </div>
                </div>
                {/* The same name the collapsed header takes over saying once
                    this has scrolled out of view — never both at once. */}
                <h1
                  className="bond-dock__detail-large-title"
                  data-collapsed={detailTitleCollapsed}
                  aria-hidden={detailTitleCollapsed}
                >
                  {detailTitle()}
                </h1>

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
                    {avatarChoice === undefined ? null : (
                      <div className="avatar-choice">
                        <AvatarModelField
                          state={createAvatarFieldViewState("bond", bondAvatar)}
                          onOpen={() => openAvatarEditor("bond")}
                        />
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
                      </div>
                    )}
                    <dl className="bond-profile__rows">
                      <div>
                        <dt>Providers</dt>
                        <dd>
                          {providers === undefined ? (
                            <small className="profile-edit__note" role="status">
                              Loading…
                            </small>
                          ) : (
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
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                ) : null}

                {section === "settings" ? (
                  <>
                    <LanguageSettings />
                    {localModel === undefined ? null : (
                      <LocalModelSettings
                        host={localModel.host}
                        catalog={localModel.catalog}
                        defaultModelId={localModel.defaultModelId}
                      />
                    )}
                    {/* Hidden for now — uncomment together with the import above.
                    <BondArtificialPositionSettings
                      ownerPubDress={pubDress}
                      renderer={renderer}
                    />
                    */}
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

                {activeDetail === "avaia" ? (
                  <>
                    {/* A host that cannot read the Avaia's profile configures
                        nothing here; what this device noted is still its own. */}
                    {avaiaSetup === undefined ? null : (
                      <>
                        <AvaiaSetupView
                          state={avaiaSetup}
                          onDraftChange={(value) => onAvaiaSetupChange?.(value)}
                          onSubmit={() => void submitAvaiaSetup()}
                        />
                        <AvatarModelField
                          state={createAvatarFieldViewState(
                            "avaia",
                            avaiaAvatar,
                          )}
                          onOpen={() => openAvatarEditor("avaia")}
                        />
                      </>
                    )}
                    <section
                      className="avaia-notebook"
                      aria-labelledby="avaia-notebook-title"
                    >
                      <span
                        className="interface-settings__eyebrow"
                        id="avaia-notebook-title"
                      >
                        {t("avaia.notebook.title")}
                      </span>
                      {avaiaStudied.length === 0 ? (
                        <p className="profile-edit__note">
                          {t("avaia.notebook.empty")}
                        </p>
                      ) : (
                        <ul className="avaia-notebook__list">
                          {avaiaStudied.map(({ landmark }) => (
                            <li key={landmark.id}>
                              <strong>{landmarkLabel(locale, landmark)}</strong>
                              <small>
                                {[
                                  landmark.kind,
                                  ...Object.entries(landmark.facts)
                                    .filter(([key]) => !key.startsWith("name"))
                                    .map(([key, value]) => `${key}: ${value}`),
                                ].join(" · ")}
                              </small>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="interface-settings__note">
                        {t("avaia.notebook.note")}
                      </p>
                    </section>
                  </>
                ) : null}

                {activeDetail === "avatar" && avatarDraft !== undefined ? (
                  <AvatarEditorView
                    state={createAvatarEditorViewState({
                      subject: detailState?.subject ?? "bond",
                      ...((detailState?.subject === "avaia"
                        ? avaiaAvatar
                        : bondAvatar) === undefined
                        ? {}
                        : {
                            persisted: (detailState?.subject === "avaia"
                              ? avaiaAvatar
                              : bondAvatar) as AvatarSelection,
                          }),
                      draft: avatarDraft,
                      busy: avatarSaving,
                      ...(avatarError === undefined
                        ? {}
                        : { error: avatarError }),
                    })}
                    onChooseModel={(model) =>
                      setAvatarDraft(chooseDraftModel(avatarDraft, model))
                    }
                    onEquip={(itemId) =>
                      setAvatarDraft(equipInDraft(avatarDraft, itemId))
                    }
                    onCancel={closeAvatarEditor}
                    onSave={() => void saveAvatarDraft()}
                  />
                ) : null}

                {activeDetail === "providers" ? (
                  <div className="provider-management">
                    {providers === undefined ? (
                      <p className="interface-settings__note" role="status">
                        Loading provider connections…
                      </p>
                    ) : (
                      <>
                        <ul className="provider-management__list">
                          {providers.rows.map((row) => (
                            <li
                              key={row.provider}
                              data-connected={row.connected}
                            >
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
                          A provider account is an identity this Bond points at,
                          one account per provider. Disconnecting detaches it
                          from this Bond; it never deletes the account on the
                          provider.
                        </p>
                      </>
                    )}
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
          <FogRevealPrompt
            prompt={fogReveal.prompt}
            jobs={fogReveal.jobs}
            avaia={avaiaLabel}
            onConfirm={confirmFogReveal}
            onDismiss={fogReveal.dismiss}
          />
          <span className="visually-hidden" aria-live="polite">
            {fogAnnouncement}
          </span>
          {/* The map is hidden from assistive technology, so what the Avaia
              says to itself on the card is said here too. */}
          <span className="visually-hidden" aria-live="polite">
            {avaiaSpeech ?? ""}
          </span>
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
