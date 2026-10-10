// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_CATALOG,
  type AvaiaProfileUpdateResult,
  type AvaiaTravelResult,
  type AvatarModelResult,
  type AvatarSelection,
  type BondProviderConnections,
  type BondProviderType,
  type CommittedAwardAccessPort,
  type CoreRuntimePort,
  type NearbySpeechAccessPort,
  type PubInfoAccessPort,
} from "@nilx-one/application";
import type {
  GeolocationCapability,
  HostPort,
  SoundCapability,
} from "@nilx-one/host-contract";
import {
  avatarPreviewUrl,
  mapDistanceMeters,
  type AvatarHandle,
  type AvatarModelId,
  type MapDimension,
  type MapObservedPositionLabel,
  type MapPointSelection,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import { StatusToastStack, type StatusToastItem } from "@nilx-one/ui";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type UIEvent,
} from "react";

import { AppHeader, type HeaderAction } from "../../shell/app-header";
import { AppShell, type ShellSafeArea } from "../../shell/app-shell";
import { chooseAppearance, useAppearance } from "../../shell/appearance";
import { DockWindow } from "../../shell/dock-window";
import { LanguageSettings } from "../../shell/language-settings";
import {
  useSoundCue,
  useSoundPreference,
  useSoundVoice,
  useVoicePreference,
} from "../../shell/sound-preference";
import { SoundSettings } from "../../shell/sound-settings";
import { SettingsSlider } from "../../shell/settings-slider";
import { PickupSettings } from "../finds/pickup-settings";
import { useBackpackGift } from "../inventory/backpack-gift";
import { useCraftCompletion } from "../inventory/craft";
import { pickUpFind } from "../inventory/inventory";
import { InventoryPanel } from "../inventory/inventory-panel";
import { thingName } from "../inventory/thing-name";
import { useWorkshop } from "../inventory/workshops";
import {
  DOCK_ACTION_KEYS,
  DOCK_ROLE_KEYS,
  RUNTIME_LABEL_KEYS,
  isTranslationKey,
  translate,
  translateCopy,
  translateFirst,
  translateIf,
  useLocalization,
  type ProductLocale,
  type Translate,
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
  draftMovedFrom,
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
  unconfiguredAvaiaStudy,
} from "./avatar-presence";

import {
  handoverComplete,
  HANDOVER_MS,
  wheelBody,
  type WheelHandover,
} from "./wheel-handover";
import {
  createBondDockViewState,
  openingWheel,
  type AvaiaAvailability,
  type DockIdentityViewState,
  type DockPlace,
  type DockSeat,
} from "./bond-dock-view-model";
import { landmarkKindLabel, landmarkLabel } from "./avaia-lines";
import { studiedBy } from "./landmark-notebook";
import { placeLandmark } from "./place-affinity";
import {
  ACHIEVEMENTS,
  avaiaExperienceForLevel,
  bondExperienceForLevel,
  earnDeviceAchievement,
  markSettingsHintSeen,
  progressionSnapshot,
  progressionStanding,
  subscribeProgression,
  updateProgression,
  EMPTY_PROGRESSION,
  type LevelStanding,
} from "../progression/progression";
import { usePubInfoSync } from "../progression/use-pub-info-sync";
import { earnActivity } from "../progression/committed-sync";
import {
  AchievementDialog,
  type AchievementDialogState,
} from "../progression/achievement-dialog";
import { pinnedLandmarks } from "./pinned-landmarks";
import { useAvaiaWalk } from "./use-avaia-walk";
import { useFindLoop } from "./use-find-loop";
import { useOrbSpills } from "../finds/use-orb-spills";
import { readWorldMemory, rememberWorld } from "./world-memory";
import { FogRevealPrompt } from "./fog-reveal-prompt";
import { AvaiaTravelPrompt } from "./avaia-travel-prompt";
import {
  avaiaTravelDecision,
  AVAIA_TRAVEL_MAX_FIX_AGE_MS,
} from "./avaia-travel-policy";
import { useFogReveal, type FogRevealState } from "./use-fog-reveal";
import { useNearbySpeech } from "./use-nearby-speech";
import { avaiaVoiceUrl, guideVoiceUrl } from "./avaia-voice";
import { useWorldAmbience } from "./world-ambience";
import { useLocalModelReadiness } from "./use-local-model-readiness";
import { useDriveChooser } from "./drive-chooser";
import { useAvaiaLife, type LifeBody } from "./use-avaia-life";
import { useAvaiaProximity } from "./use-avaia-proximity";
import { useReadinessFrameVisible } from "./use-readiness-frame";
import { createWorldReadiness } from "./world-readiness";
import { AvaiaSetupView } from "../avaia/avaia-setup-view";
import type { AvaiaSetupViewState } from "../avaia/avaia-setup-view-model";
import { GuideCutsceneView } from "../guide/guide-cutscene-view";
import {
  GuideRewardToasts,
  type GuideRewardToast,
} from "../guide/guide-reward-toasts";
import {
  guideIntroOwed,
  postponeGuideIntro,
  rememberGuideIntro,
} from "../guide/guide-memory";
import type { GuideOutcome, GuideSceneId } from "../guide/guide-script";
import { guideResultToast } from "../guide/guide-result-toast";
import type { GuidePlayOptions } from "../guide/use-guide-cutscene";
import { useGuideCutscene } from "../guide/use-guide-cutscene";

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
  /** Host feedback for a tap on the Dock; the host decides what it feels like. */
  readonly feedback?: Pick<HostPort, "impact">;
  /**
   * The host's sound. What the world does is marked with a cue and, when the
   * person asked for it, the world in view is heard under them.
   */
  readonly sound?: SoundCapability;
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
   * Publishes activity experience into this Bond's `pub_info` and reads the
   * shared total back. Absent when this host's identity client has no such
   * capability — the device then keeps what it earned until one does.
   */
  readonly pubInfo?: PubInfoAccessPort;
  /**
   * Commits newly earned activity through R3. The history remains local; this
   * port receives only commitments and the fields the identity service prices.
   */
  readonly committedAwards?: CommittedAwardAccessPort;
  /**
   * Core, naming what a find is and reading the pick-up setting. Absent or
   * older, finds are still paid; the toast then names the tier, not the item.
   */
  readonly findItems?: Pick<
    CoreRuntimePort,
    | "findItem"
    | "picksUp"
    | "economyCatalog"
    | "applyInventoryCommand"
    | "backpackGiftDue"
    | "avaiaDriveStep"
    | "applyAvaiaLife"
    | "avaiaProximity"
    | "orbWorld"
  >;
  /**
   * Lets the signed-in Bond hear the Bonds within earshot. Absent when this
   * host's identity client has no such capability, which is a normal state.
   */
  readonly nearbySpeech?: NearbySpeechAccessPort;
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
  /** Explicitly consented physical arrival, never a declared Bond position. */
  readonly onBringAvaia?: (
    position: MapPointSelection,
  ) => Promise<AvaiaTravelResult>;
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
type IdentityDetail = "providers" | "avaia" | "avatar" | "inventory";

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
 * What names a section of a Dock screen: a fieldset's legend, or the eyebrow
 * a section opens with. A field's own eyebrow label names a field, not a
 * section, and a legend nested in another fieldset names part of a section;
 * neither takes over the header.
 */
const DOCK_SECTION_TITLE_SELECTOR =
  "legend, .interface-settings__eyebrow:not(label)";

/**
 * The last section title the body has carried up past the top of its
 * scroller, or nothing while the screen is still above its first section.
 * A title that has no box of its own (not laid out) has passed nowhere.
 */
function passedSectionTitle(scroller: HTMLElement): string | undefined {
  const top = scroller.getBoundingClientRect().top;
  let passed: string | undefined;
  for (const title of scroller.querySelectorAll<HTMLElement>(
    DOCK_SECTION_TITLE_SELECTOR,
  )) {
    if (title.parentElement?.parentElement?.closest("fieldset")) continue;
    const box = title.getBoundingClientRect();
    if (box.height === 0) continue;
    if (box.bottom >= top) break;
    const text = title.textContent?.trim();
    if (text) passed = text;
  }
  return passed;
}

/** Long enough to read "saved", short enough not to linger over the world. */
const AVAIA_SAVED_TOAST_MS = 4_000;
const FIND_TOAST_MS = 6_000;

/**
 * The world has settled — the map painted, the first fix framed — before
 * xSasha walks up, so her arrival is not lost in the camera finding its feet.
 */
export const GUIDE_INTRO_DELAY_MS = 1_800;

export function levelFill(standing: LevelStanding, seat: DockSeat): number {
  const currentLevelXp =
    seat === "avaia"
      ? avaiaExperienceForLevel(standing.level)
      : bondExperienceForLevel(standing.level);
  const levelSpan = standing.nextLevelXp - currentLevelXp;
  return levelSpan > 0 ? (standing.xp - currentLevelXp) / levelSpan : 0;
}

/**
 * The Dock's status and inventory in one mark: a bag, filled as far as the
 * driver's state goes. `fill` runs from 0 to 1.
 */
function StatusGlyph({ fill }: { readonly fill: number }) {
  const level = Math.min(1, Math.max(0, fill));
  const height = 5.5 * level;
  return (
    <svg
      className="bond-dock__status-glyph"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <path
        d="M7.5 6V4.5a2.5 2.5 0 0 1 5 0V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="3.75"
        y="6"
        width="12.5"
        height="12"
        rx="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.75 9.5h12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        className="bond-dock__status-fill"
        x="6"
        y={16 - height}
        width="8"
        height={height}
        rx="1"
      />
    </svg>
  );
}

function levelSummary(t: Translate, standing: LevelStanding): string {
  return t("progression.summaryNext")
    .replace("{level}", String(standing.level))
    .replace("{xp}", String(standing.xp))
    .replace("{next}", String(standing.nextLevelXp));
}

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
  const { t } = useLocalization();
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
          {state.busy ? t("dock.saving") : t("dock.save")}
        </button>
      </div>
      <p className="profile-edit__note" id={`${id}-note`}>
        {translateFirst(t, state.note, [
          "dock.caseSensitiveBond",
          "address.note.fixed",
          "address.note.range",
          "identity.status.idle",
        ])}
      </p>
      {state.error === undefined ? null : (
        <p className="profile-edit__error" role="alert">
          {translateCopy(t, state.error)}
        </p>
      )}
      {state.saved === undefined ? null : (
        <p className="profile-edit__saved" role="status">
          {t("address.saved").replaceAll("{name}", state.saved)}
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
  const { t } = useLocalization();
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
      aria-label={translateCopy(t, row.openLabel)}
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

/**
 * One identity's place on the Dock. Its colour follows who it is, its
 * emphasis follows whether it is driving; where it sits never changes.
 */
function DockPlaceButton({
  place: { driving, identity },
  onActivate,
}: {
  readonly place: DockPlace;
  readonly onActivate: (identity: DockIdentityViewState) => void;
}) {
  const { t } = useLocalization();
  return (
    <button
      className={`bond-dock__bond bond-dock__bond--${identity.seat}${
        driving ? " bond-dock__bond--active" : ""
      }${driving || identity.actionable ? "" : " bond-dock__bond--unavailable"}`}
      type="button"
      disabled={!identity.actionable}
      onClick={() => onActivate(identity)}
      aria-label={translateFirst(t, identity.actionLabel, DOCK_ACTION_KEYS)}
    >
      <span className="bond-dock__glyph">
        {translateIf(t, "dock.ai", identity.glyph)}
      </span>
      <strong>{identity.address}</strong>
      <small>
        {identity.seat === "bond" ? t("dock.you") : t("dock.ai")}
        <i
          className={`bond-dock__status-dot bond-dock__status-dot--${identity.tone}`}
          aria-hidden="true"
        />
        {translateFirst(t, identity.role, DOCK_ROLE_KEYS)}
      </small>
    </button>
  );
}

export function AuthenticatedMapHomeView({
  hostLabel,
  pubDress,
  avaiaPubDress,
  renderer,
  geolocation,
  feedback,
  sound,
  runtime,
  safeArea,
  section = "world",
  localModel,
  pubInfo,
  committedAwards,
  findItems,
  nearbySpeech,
  connectedProviders,
  providerDeepLinks = [],
  onDisconnectProvider,
  avaiaAvailability = "unavailable",
  onPrepareAvaia,
  slugEdit,
  avaiaSetup,
  onAvaiaSetupChange,
  onAvaiaSetupSubmit,
  onBringAvaia,
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
  // The Dock's fixed subtitle names the screen from the first frame. Further
  // down it follows the body: the last section title carried past the header
  // takes over, and the screen name returns above the first section.
  const [dockSectionTitle, setDockSectionTitle] = useState<string | undefined>(
    undefined,
  );
  const appearance = useAppearance();
  const [mapStatus, setMapStatus] = useState<MapRendererStatus>(() =>
    renderer.getStatus(),
  );
  const [dismissedStatus, setDismissedStatus] = useState<string | undefined>(
    undefined,
  );
  // Readiness notices a person closed stay closed while their cause stands.
  const [dismissedReadiness, setDismissedReadiness] = useState<
    ReadonlySet<string>
  >(() => new Set());
  // What the service stored, said once where every transient notice is said.
  // It is not dismissed on a timer: a person closes it when they have read it.
  const [avaiaSavedToast, setAvaiaSavedToast] = useState<
    StatusToastItem | undefined
  >(undefined);
  const [sceneToasts, setSceneToasts] = useState<readonly StatusToastItem[]>(
    [],
  );
  const sceneSequence = useRef(0);
  const [findToast, setFindToast] = useState<StatusToastItem | undefined>(
    undefined,
  );
  // Orbs come by the handful: one toast counts them while it is up, per
  // whoever picked them up.
  const orbTally = useRef<
    | {
        readonly id: string;
        readonly count: number;
        readonly xp: number;
        readonly at: number;
      }
    | undefined
  >(undefined);
  const [achievementDialog, setAchievementDialog] = useState<
    AchievementDialogState | undefined
  >(undefined);
  // Who is at the wheel is presentation: it moves nothing in the shared world.
  // The authenticated world opens on the Avaia, with its Bond spectating: the
  // first thing a person sees is the character they point around the world,
  // and taking the wheel back is one tap on the Dock. An Avaia nobody has
  // configured yet is not someone to spectate, so a fresh Bond opens driving
  // itself. The opening seat is decided once, when the configuration is first
  // known; after that the wheel only moves when a person moves it.
  const avaiaConfiguration = avaiaSetup?.configuration;
  const [chosenWheel, setChosenWheel] = useState<DockSeat | undefined>(
    undefined,
  );
  if (
    chosenWheel === undefined &&
    (avaiaSetup === undefined || avaiaConfiguration !== undefined)
  ) {
    setChosenWheel(openingWheel(avaiaConfiguration));
  }
  const wheel: DockSeat = chosenWheel ?? "avaia";
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
  const [travelPrompt, setTravelPrompt] = useState<
    | {
        readonly longitude: number;
        readonly latitude: number;
        readonly observedAt: number;
      }
    | undefined
  >(undefined);
  const [travelBusy, setTravelBusy] = useState(false);
  const [travelError, setTravelError] = useState(false);
  const askedAway = useRef({ owner: pubDress, value: false });
  if (askedAway.current.owner !== pubDress) {
    askedAway.current = { owner: pubDress, value: false };
  }
  const canOfferTravel =
    avaiaSetup?.canTravel === true &&
    avaiaSetup.configuration === "configured" &&
    onBringAvaia !== undefined;
  const observedLongitude = observedPosition?.longitude;
  const observedLatitude = observedPosition?.latitude;
  const observedAccuracy = observedPosition?.accuracyMeters;
  const observedAt = observedPosition?.observedAt;
  const isDeclared = observedPosition?.declared === true;
  useEffect(() => {
    if (!canOfferTravel || travelBusy) return;
    const observation =
      observedLongitude === undefined ||
      observedLatitude === undefined ||
      observedAccuracy === undefined ||
      observedAt === undefined
        ? undefined
        : {
            longitude: observedLongitude,
            latitude: observedLatitude,
            accuracyMeters: observedAccuracy,
            observedAt,
            ...(isDeclared ? { declared: true as const } : {}),
          };
    const decision = avaiaTravelDecision({
      home: renderer.fog?.home?.(),
      observation,
      askedAway: askedAway.current.value,
      nowMs: Date.now(),
    });
    if (decision === "reset") {
      askedAway.current.value = false;
      return;
    }
    if (decision !== "ask" || observation === undefined) return;
    let current = true;
    // Avoid a synchronous React state write inside the observation effect.
    void Promise.resolve().then(() => {
      if (!current) return;
      askedAway.current.value = true;
      setTravelError(false);
      setTravelPrompt({
        longitude: observation.longitude,
        latitude: observation.latitude,
        observedAt: observation.observedAt,
      });
    });
    return () => {
      current = false;
    };
  }, [
    canOfferTravel,
    isDeclared,
    observedAccuracy,
    observedAt,
    observedLatitude,
    observedLongitude,
    renderer,
    travelBusy,
    mapStatus.kind,
  ]);

  async function confirmBringAvaia(): Promise<void> {
    if (
      travelPrompt === undefined ||
      travelBusy ||
      onBringAvaia === undefined
    ) {
      return;
    }
    if (Date.now() - travelPrompt.observedAt > AVAIA_TRAVEL_MAX_FIX_AGE_MS) {
      setTravelError(true);
      return;
    }
    setTravelBusy(true);
    setTravelError(false);
    try {
      const result = await onBringAvaia({
        longitude: travelPrompt.longitude,
        latitude: travelPrompt.latitude,
      });
      if (result.kind === "arrived") {
        setTravelPrompt(undefined);
      } else {
        setTravelError(true);
      }
    } catch {
      setTravelError(true);
    } finally {
      setTravelBusy(false);
    }
  }
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
  // What the editor opened on, so leaving it can tell a draft a person worked
  // on from one they only looked at.
  const [avatarDraftOpened, setAvatarDraftOpened] = useState<
    AvatarDraft | undefined
  >(undefined);
  // The way back has already asked once about this draft; asked again, it
  // leaves.
  const [avatarLeaveAsked, setAvatarLeaveAsked] = useState(false);
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
      : avaiaConfiguration === "unconfigured"
        ? unconfiguredAvaiaStudy(avaiaAddress, bondAvatar.modelId)
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
  const statusToast = mapStatusToast(
    mapStatus,
    translateCopy(t, mapViewModel.label),
    translateCopy(t, mapViewModel.detail),
  );
  const cue = useSoundCue(sound);
  const speak = useSoundVoice(sound);
  const soundPreference = useSoundPreference();
  const voicePreference = useVoicePreference();
  useWorldAmbience({
    renderer,
    sound,
    enabled: soundPreference === "all" && mapStatus.kind === "ready",
  });
  const speech = useNearbySpeech({
    port: nearbySpeech,
    onHeard: () => cue("heard"),
  });
  // Settings is where the model is downloaded or removed, so leaving it is
  // when this device is asked again.
  const localModelReadiness = useLocalModelReadiness(
    localModel,
    section === "settings",
  );
  const readiness = createWorldReadiness({
    map: mapStatus,
    location: location.state,
    model: localModelReadiness,
  });
  const readinessShown = useReadinessFrameVisible(readiness.tone);
  const readinessToasts = readiness.issues
    .filter((issue) => !dismissedReadiness.has(issue.id))
    .map((issue): StatusToastItem => ({
      id: issue.id,
      kind: "error",
      title: t(issue.title),
      description: t(issue.detail),
    }));
  const statusToasts = [
    ...(statusToast === undefined || statusToast.id === dismissedStatus
      ? []
      : [statusToast]),
    ...readinessToasts,
    ...(avaiaSavedToast === undefined ? [] : [avaiaSavedToast]),
    ...(findToast === undefined ? [] : [findToast]),
    ...speech.toasts,
    ...sceneToasts,
  ];
  const headerActions: readonly HeaderAction[] =
    onLogout === undefined
      ? []
      : [{ id: "sign-out", label: t("header.signOut"), perform: onLogout }];
  // The study the Avaia is drawn in, whose voice it speaks in. No body drawn
  // means no voice either: a card does not talk on behalf of nobody.
  const avaiaVoice: AvatarModelId | undefined = avaiaAvatar?.modelId as
    AvatarModelId | undefined;
  // A declared point stands the Bond somewhere; only a real observation says
  // this device is anywhere.
  const declaredPosition = observedPosition?.declared === true;
  const deviceObservation = declaredPosition ? undefined : observedPosition;
  // A real repair workshop this device stands at opens its repairs.
  const workshop = useWorkshop(renderer, deviceObservation);
  const findLoop = useFindLoop({
    owner: pubDress,
    port: committedAwards,
    pickup: findItems,
    bondDriving: wheel === "bond" && handover === undefined,
    device: deviceObservation,
    onEvent: (event) => {
      if (event.kind === "orb-kept") {
        cue("spot");
        const id = `orb-kept-${event.earner}`;
        const now = Date.now();
        const last = orbTally.current;
        const tally =
          last?.id === id && now - last.at < FIND_TOAST_MS
            ? last
            : { id, count: 0, xp: 0, at: now };
        const next = {
          id,
          count: tally.count + 1,
          xp: tally.xp + event.experience,
          at: now,
        };
        orbTally.current = next;
        setFindToast({
          id,
          kind: "active",
          tone: event.earner,
          title: t(
            event.earner === "avaia"
              ? "orb.toast.kept.avaia"
              : "orb.toast.kept.bond",
          ),
          description: t("orb.toast.kept.detail")
            .replace("{count}", String(next.count))
            .replace("{xp}", String(next.xp)),
        });
        return;
      }
      if (event.kind === "orb-taken") {
        cue("failure");
        setFindToast({
          id: `orb-taken-${event.orb}`,
          kind: "error",
          tone: event.earner,
          title: t("orb.toast.taken.title"),
          description: t("orb.toast.taken.detail"),
        });
        return;
      }
      if (event.kind === "find-taken") {
        cue("failure");
        setFindToast({
          id: `find-taken-${event.artifactId}`,
          kind: "error",
          title: t("find.toast.taken.title"),
          description: t("find.toast.taken.detail"),
        });
        return;
      }
      if (event.kind === "find-seen" && event.tier >= 4) {
        cue("spot");
        setFindToast({
          id: `find-seen-${event.artifactId}`,
          kind: "active",
          title: t("find.toast.rare.title"),
          description: t("find.toast.rare.detail").replace(
            "{tier}",
            String(event.tier),
          ),
        });
        return;
      }
      if (event.kind === "find-kept") {
        cue("achievement");
        // A kept find goes into its finder's grid, once. One that fits
        // nowhere stays where it lay, and the toast says so.
        if (findItems?.applyInventoryCommand !== undefined) {
          void pickUpFind(pubDress, findItems, {
            artifactId: event.artifactId,
            tier: event.tier,
            holder: event.earner,
          })
            .then(async (answer) => {
              if (answer === "already-in" || answer.ok) return;
              if (answer.error !== "no_room") return;
              const item = await findItems.findItem?.(
                event.artifactId,
                event.tier,
              );
              setFindToast({
                id: `find-full-${event.artifactId}`,
                kind: "error",
                title: t("inventory.title"),
                description: t("inventory.full").replace(
                  "{item}",
                  item?.kind === "item" ? thingName(t, item.id) : "",
                ),
              });
            })
            .catch(() => undefined);
        }
        const toast = {
          id: `find-kept-${event.artifactId}`,
          kind: "active" as const,
          title: t("find.toast.kept.title"),
          description: t("find.toast.kept.detail")
            .replace("{tier}", String(event.tier))
            .replace("{xp}", String(event.experience)),
        };
        setFindToast(toast);
        // What it is comes from Core; until (or unless) it answers, the
        // toast says only that something was kept.
        void findItems
          ?.findItem?.(event.artifactId, event.tier)
          .then(async (item) => {
            if (item.kind !== "item") return;
            const key = `item.${item.id}`;
            if (!isTranslationKey(key)) return;
            // What it paid is the item's, as the service prices it: a rare
            // CD radio is worth 25, not its tier's 400.
            const catalog = await findItems
              .economyCatalog?.()
              .catch(() => undefined);
            const worth = catalog?.found.find(
              (found) => found.id === item.id,
            )?.experience;
            setFindToast((current) =>
              current?.id === toast.id
                ? {
                    ...toast,
                    title: t(key),
                    ...(worth === undefined
                      ? {}
                      : {
                          description: t("find.toast.kept.detail")
                            .replace("{tier}", String(event.tier))
                            .replace("{xp}", String(worth)),
                        }),
                  }
                : current,
            );
          })
          .catch(() => undefined);
      }
    },
  });
  // A confirmed craft finishes in the background, wherever the person is.
  useCraftCompletion({
    owner: pubDress,
    core: committedAwards === undefined ? undefined : findItems,
    committed: committedAwards !== undefined,
    onFinished: (finished) => {
      cue("achievement");
      setFindToast({
        id: `craft-done-${finished.recipe}-${Date.now()}`,
        kind: "active",
        title: t("craft.done.title").replace(
          "{item}",
          finished.makes === undefined ? "" : thingName(t, finished.makes),
        ),
        description: t("craft.done.detail").replace(
          "{xp}",
          String(finished.experience),
        ),
      });
    },
  });
  // The Avaia answers fog taps through the reveal below, which in turn talks
  // in the Avaia's voice: the ref is what lets the two hooks meet.
  const fogRevealRef = useRef<FogRevealState | undefined>(undefined);
  // Where a choice is the Avaia's own, the model on this device makes it,
  // once the person has it here.
  const driveChooser = useDriveChooser(localModel, localModelReadiness);
  // Its needs are Core's: this device reports where the body is and whether
  // it walks, and the drive hears what they ask. The walk hook is created
  // below, so the body is read through a ref it fills.
  const avaiaBody = useRef<() => LifeBody | undefined>(() => undefined);
  const avaiaLife = useAvaiaLife({
    core: findItems,
    owner: pubDress,
    subject: avaiaAddress,
    active: wheel === "avaia" && handover === undefined,
    body: () => avaiaBody.current(),
    home: renderer.fog?.home?.() ?? deviceObservation,
  });
  const avaiaWalk = useAvaiaWalk({
    renderer,
    active: wheel === "avaia" && handover === undefined,
    observed: observedPosition,
    ...(avaiaSetup?.travelArrival === undefined
      ? {}
      : { travelArrival: avaiaSetup.travelArrival }),
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
    core: findItems,
    chooser: driveChooser,
    life: avaiaLife,
    onCue: cue,
    onWalkCompleted: findLoop.completedAvaiaWalk,
    onAward: (record) => {
      void earnActivity(pubDress, record, committedAwards !== undefined);
    },
    // The line is on the card either way; a recording only says it aloud.
    // Its own walking lines are the loudest level: the person is driving it.
    onLine: (line) => {
      if (soundPreference === "off" || voicePreference !== "all") return;
      if (avaiaVoice === undefined) return;
      const url = avaiaVoiceUrl({ locale, model: avaiaVoice, ...line });
      if (url !== undefined) speak({ url });
    },
  });
  useEffect(() => {
    avaiaBody.current = () => {
      const stance = avaiaWalk.stance(globalThis.performance.now());
      const point = stance?.point ?? observedPosition;
      if (point === undefined) return undefined;
      return {
        point: { longitude: point.longitude, latitude: point.latitude },
        motion: stance?.clipId === "walk" ? "walking" : "idle",
      };
    };
  }, [avaiaWalk, observedPosition]);
  // An Avaia who has never been anywhere is put down once, where this device
  // first located its Bond: from then on she has a place of her own, and
  // leaves it only by walking or being given the wheel. Without this, a fresh
  // Avaia would have no place at all and nothing could measure how far she is.
  // Only her remembered place is written: what she is doing is left alone.
  const avaiaWalkRef = useRef(avaiaWalk);
  useEffect(() => {
    avaiaWalkRef.current = avaiaWalk;
  });
  const avaiaPlacedFor = useRef<string | undefined>(undefined);
  // A manually declared Bond position cannot become Avaia's first
  // whereabouts: /set_position moves only Bond, never Avaia.
  const firstFixLongitude = declaredPosition
    ? undefined
    : observedPosition?.longitude;
  const firstFixLatitude = declaredPosition
    ? undefined
    : observedPosition?.latitude;
  useEffect(() => {
    if (firstFixLongitude === undefined || firstFixLatitude === undefined) {
      return;
    }
    if (avaiaPlacedFor.current === pubDress) return;
    avaiaPlacedFor.current = pubDress;
    const placed =
      avaiaWalkRef.current.stance(globalThis.performance.now()) !== undefined ||
      readWorldMemory(pubDress).avaia !== undefined;
    if (!placed) {
      rememberWorld(pubDress, {
        avaia: {
          longitude: firstFixLongitude,
          latitude: firstFixLatitude,
          bearingDeg: 0,
        },
      });
    }
  }, [firstFixLatitude, firstFixLongitude, pubDress]);
  // Camera and handover never define proximity; measure independent bodies.
  // Her place is what she stands at or was left at — never assumed to be the
  // Bond's device after that first putting-down, and unknown (not near)
  // whenever it cannot be read.
  const avaiaProximity = useAvaiaProximity({
    core: findItems,
    owner: pubDress,
    bondPoint: observedPosition,
    getAvaiaPoint: () =>
      avaiaWalk.stance(globalThis.performance.now())?.point ??
      readWorldMemory(pubDress).avaia,
  });
  // The avatar's true animation-frame position can cross the red boundary
  // between Core polling beats; feed those frames to the proximity guard.
  const proximityObserver = useRef(avaiaProximity?.observeAvaiaPoint);
  useEffect(() => {
    proximityObserver.current = avaiaProximity?.observeAvaiaPoint;
  }, [avaiaProximity]);
  const [fogAnnouncement, setFogAnnouncement] = useState("");
  // Orbs spill from every opened cell. The driving Bond collects at its
  // gameplay position (physical GPS or manual/virtual); the Avaia collects
  // where its own body walks. Manual position stays excluded from physical
  // presence checks, such as workshops and first-hand find discoveries.
  const orbSpills = useOrbSpills({
    owner: pubDress,
    port: committedAwards,
    core: findItems,
    renderer,
    near: observedPosition,
    bond:
      wheel === "bond" && handover === undefined
        ? observedPosition
        : undefined,
    avaiaPoint: () =>
      wheel === "avaia" && handover === undefined
        ? avaiaWalk.stance(globalThis.performance.now())?.point
        : undefined,
  });
  const fogReveal = useFogReveal({
    renderer,
    bondPoint: observedPosition,
    enforceProximity: true,
    proximity: avaiaProximity,
    observed: deviceObservation,
    owner: pubDress,
    onRevealed: (cell, via) => {
      setFogAnnouncement(t("fog.announce.revealed"));
      cue("reveal");
      orbSpills.spill(cell);
      void earnActivity(
        pubDress,
        {
          kind: via === "avaia" ? "zone_revealed" : "zone_walked",
          earner: via === "avaia" ? "avaia" : "bond",
          subject: cell.id,
          at: Date.now(),
        },
        committedAwards !== undefined,
      );
      if (via === "avaia" && wheel === "avaia" && handover === undefined) {
        avaiaWalk.announce("fog.revealed");
      }
    },
  });
  usePubInfoSync(pubDress, pubInfo);
  const progression = useSyncExternalStore(
    subscribeProgression,
    () => progressionSnapshot(pubDress),
    () => EMPTY_PROGRESSION,
  );
  const accountFacts = { avaiaConfigured: avaiaConfiguration === "configured" };
  const standing = progressionStanding(progression, accountFacts);
  // Once the Avaia is configured, downloading its model on this device is the
  // next step: Settings is marked until it has been opened, and "Download now"
  // until the model is here.
  const downloadPending =
    localModel !== undefined &&
    standing.achievements.includes("avaia-configured") &&
    !standing.achievements.includes("avaia-model-downloaded");
  const settingsAttention =
    downloadPending && !progression.settingsHintSeen && section !== "settings";
  useEffect(() => {
    if (section === "settings" && downloadPending) {
      updateProgression(pubDress, markSettingsHintSeen);
    }
  }, [downloadPending, pubDress, section]);
  // "Saved" is a passing confirmation; what it paid is the dialog's to say.
  useEffect(() => {
    if (avaiaSavedToast === undefined) return;
    const fades = globalThis.setTimeout(
      () => setAvaiaSavedToast(undefined),
      AVAIA_SAVED_TOAST_MS,
    );
    return () => globalThis.clearTimeout(fades);
  }, [avaiaSavedToast]);
  useEffect(() => {
    if (findToast === undefined) return;
    const fades = globalThis.setTimeout(
      () => setFindToast(undefined),
      FIND_TOAST_MS,
    );
    return () => globalThis.clearTimeout(fades);
  }, [findToast]);
  useEffect(() => {
    fogRevealRef.current = fogReveal;
  });
  // Opening a Dock screen turns the person's attention away from the world
  // the prompt floats over; whatever it was asking is no longer being
  // answered.
  useEffect(() => {
    fogRevealRef.current?.dismiss();
  }, [activeDetail]);
  // A screen just opened reads from its own top, with the fixed header naming
  // that screen — never scrolled to wherever the screen before it was left.
  const detailScreenKey = `${section}:${activeDetail ?? ""}`;
  if (detailScreenKey !== renderedDetailScreenKey.current) {
    renderedDetailScreenKey.current = detailScreenKey;
    if (dockSectionTitle !== undefined) setDockSectionTitle(undefined);
  }
  useEffect(() => {
    // The header stays put. Only the body under it scrolls, and a screen
    // just opened starts that body at its top.
    const dock = dockRef.current;
    if (dock === null) return;
    const scroller = dock.querySelector<HTMLElement>(
      ".bond-dock__screen:not([data-phase='from']) .bond-dock__scroll",
    );
    if (scroller === null) return;
    scroller.scrollTop = 0;
  }, [activeDetail, section]);
  const avaiaSpeech =
    wheel === "avaia" && handover === undefined
      ? avaiaWalk.speech?.text
      : undefined;
  const avaiaStudied = studiedBy(avaiaWalk.notebook, avaiaAddress);
  const reducedMotion = prefersReducedMotion();
  const guide = useGuideCutscene({
    renderer,
    anchor: observedPosition,
    bondModel: bondAvatar?.modelId as AvatarModelId | undefined,
    ...(avaiaAvatar === undefined
      ? {}
      : {
          avaia: {
            model: avaiaAvatar.modelId as AvatarModelId,
            appearance: avaiaAvatar.appearance,
          },
        }),
    bondName: pubDress,
    names: { avaia: avaiaLabel, bond: pubDress },
    reducedMotion,
    onEnd: (scene, outcome, result) => endGuideScene(scene, outcome, result),
  });
  const guideActive = guide.state !== undefined;
  // In a cutscene the characters who are not the person speak: xSasha says
  // her line when it opens. The person's own replies are never voiced.
  const guideBeat = guide.state?.beat;
  const guideLineKey = guide.state?.line.key;
  const guideLineVoice = guide.state?.line.voice;
  // Read when a line opens, so a change of preference mid-line does not say
  // the same line again.
  const cutsceneVoice = useRef({
    soundPreference,
    voicePreference,
    locale,
    speak,
  });
  useEffect(() => {
    cutsceneVoice.current = { soundPreference, voicePreference, locale, speak };
  });
  useEffect(() => {
    if (guideBeat !== "line" || guideLineKey === undefined) return;
    if (guideLineVoice === undefined) return;
    const now = cutsceneVoice.current;
    if (now.soundPreference === "off" || now.voicePreference === "off") return;
    const url = guideVoiceUrl({
      locale: now.locale,
      voice: guideLineVoice,
      key: guideLineKey,
    });
    if (url !== undefined) now.speak({ url });
  }, [guideBeat, guideLineKey, guideLineVoice]);
  const [rewardToasts, setRewardToasts] = useState<readonly GuideRewardToast[]>(
    [],
  );
  const playGuide = guide.play;
  // She introduces herself to a Bond whose Avaia nobody has configured yet,
  // once the world is there to be filmed and nothing else is being asked.
  const guideIntroDue =
    avaiaConfiguration === "unconfigured" &&
    section === "world" &&
    activeDetail === undefined &&
    mapStatus.kind === "ready" &&
    (focusState === "focused" || focusState === "unavailable") &&
    !guideActive &&
    achievementDialog === undefined;
  // Her backpack gift comes when the Bond's pockets fill up, or by level 3:
  // given first, then said, once the world is free to film it.
  useBackpackGift({
    owner: pubDress,
    core:
      committedAwards === undefined || findItems === undefined
        ? undefined
        : findItems,
    bondLevel: standing.bond.level,
    ready:
      avaiaConfiguration !== "unconfigured" &&
      section === "world" &&
      activeDetail === undefined &&
      mapStatus.kind === "ready" &&
      (focusState === "focused" || focusState === "unavailable") &&
      !guideActive &&
      achievementDialog === undefined,
    onGiven: () => {
      const item = t("guide.backpack.item");
      playGuide("backpack", {
        gift: {
          key: "backpacks",
          title: t("guide.backpack.title"),
          items: [
            { subject: "bond", text: item },
            { subject: "avaia", text: item },
          ],
        },
      });
    },
  });
  useEffect(() => {
    if (!guideIntroDue || !guideIntroOwed(pubDress)) return;
    const arrives = globalThis.setTimeout(
      () => playGuide("intro"),
      GUIDE_INTRO_DELAY_MS,
    );
    return () => globalThis.clearTimeout(arrives);
  }, [guideIntroDue, playGuide, pubDress]);

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
  // text. It is never sent to a backend or written to telemetry; the last one
  // is kept on this device only, to reopen the world where it was left.
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
      wheel === "avaia"
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

  // A world opened again starts where it was left: the camera goes straight
  // to where the body at the wheel was last seen on this device, rather than
  // the bootstrap camera, while the first fix is still on its way.
  const resumeApplied = useRef(false);
  useEffect(() => {
    if (resumeApplied.current || mapStatus.kind !== "ready") return;
    resumeApplied.current = true;
    if (firstFixApplied.current || cameraMovedByPerson.current) return;
    const remembered = readWorldMemory(pubDress);
    const point =
      wheel === "avaia"
        ? (remembered.avaia ?? remembered.bond)
        : remembered.bond;
    if (point === undefined) return;

    const context = { presentation, dimension, safeArea };
    renderer.setCamera(
      firstFixCamera(
        {
          longitude: point.longitude,
          latitude: point.latitude,
          accuracyMeters: 0,
          observedAt: 0,
          declared: true,
        },
        context,
      ),
      { motion: "immediate", padding: locationCameraPadding(context) },
    );
  }, [
    dimension,
    mapStatus.kind,
    presentation,
    pubDress,
    renderer,
    safeArea,
    wheel,
  ]);

  // Only the first fix decides where the camera goes, so the wheel and the
  // walk are read as they stand at that instant rather than followed.
  const wheelAvaiaPoint = (): MapPointSelection | undefined =>
    wheel === "avaia"
      ? avaiaWalk.stance(globalThis.performance.now())?.point
      : undefined;
  const wheelAvaiaPointRef = useRef(wheelAvaiaPoint);
  useEffect(() => {
    wheelAvaiaPointRef.current = wheelAvaiaPoint;
  });

  // The first fix of a world recenters once, on the body at the wheel: an
  // Avaia that was left somewhere is framed where it stands. Later updates
  // move the marker; they never take the camera back from the person holding
  // it.
  useEffect(() => {
    if (observedPosition === undefined || firstFixApplied.current) return;
    firstFixApplied.current = true;
    if (cameraMovedByPerson.current) return;

    const avaiaPoint = wheelAvaiaPointRef.current();
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(
      firstFixCamera(
        avaiaPoint === undefined
          ? observedPosition
          : { ...observedPosition, ...avaiaPoint },
        context,
      ),
      {
        motion: cameraMotion(prefersReducedMotion()),
        padding: locationCameraPadding(context),
      },
    );
  }, [dimension, observedPosition, presentation, renderer, safeArea]);

  // Where this device last observed itself is kept on this device alone, so
  // the next opening of the world starts there. A declared point is the
  // service's to hold and is not copied here.
  const observedDeviceLongitude = deviceObservation?.longitude;
  const observedDeviceLatitude = deviceObservation?.latitude;
  useEffect(() => {
    if (
      observedDeviceLongitude === undefined ||
      observedDeviceLatitude === undefined
    ) {
      return;
    }
    rememberWorld(pubDress, {
      bond: {
        longitude: observedDeviceLongitude,
        latitude: observedDeviceLatitude,
      },
    });
  }, [observedDeviceLatitude, observedDeviceLongitude, pubDress]);

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
    const draft = draftFromSelection(
      selection ?? {
        modelId: AVATAR_CATALOG[0]?.id ?? "sky-study",
        appearance: {},
      },
    );
    setAvatarDraft(draft);
    setAvatarDraftOpened(draft);
    setAvatarLeaveAsked(false);
    setAvatarError(undefined);
    openDetail("avatar", subject);
  }

  function closeAvatarEditor(): void {
    const returnTo = detailState?.subject === "avaia" ? "avaia" : undefined;
    setAvatarDraft(undefined);
    setAvatarDraftOpened(undefined);
    setAvatarLeaveAsked(false);
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
    // Save answers the leave prompt. Left standing, its discard would close an
    // editor whose save is still on its way, and that save would commit the
    // very model a person had just thrown away.
    setAvatarLeaveAsked(false);
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
        setAvatarError(avatarChoice?.error ?? t("dock.saveChoiceFailed"));
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

  // The inventory needs Core's rules and committed awards to keep it.
  const inventoryReady =
    findItems?.applyInventoryCommand !== undefined &&
    committedAwards !== undefined;

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
  //
  // A body that leaves the world — the camera pulled back, the wheel handed
  // over — is hidden, not removed: its loaded study, skeleton and mixer stay
  // where they are, so coming back is a flag flip rather than a fresh fetch and
  // clone. Only the renderer going away drops them.
  const drawnBodies = useRef<Partial<Record<DockSeat, AvatarHandle>>>({});
  useEffect(() => {
    const avatars = renderer.avatars;
    if (avatars === undefined) return;
    const drawn = drawnBodies.current;
    return () => {
      for (const id of Object.values(BODY_HANDLE_IDS)) avatars.remove(id);
      for (const seat of Object.keys(drawn) as DockSeat[]) delete drawn[seat];
    };
  }, [renderer]);

  useEffect(() => {
    const avatars = renderer.avatars;
    const bondStudy = avatarChoice?.rendered;
    if (avatars === undefined) return;
    const avatarLayer = avatars;
    const drawn = drawnBodies.current;
    function hide(seat: DockSeat): void {
      const last = drawn[seat];
      if (last === undefined || !last.visible) return;
      const hidden = { ...last, visible: false };
      drawn[seat] = hidden;
      avatarLayer.upsert(hidden);
    }
    if (bondStudy === undefined || observedPosition === undefined) {
      for (const seat of Object.keys(BODY_HANDLE_IDS) as DockSeat[]) hide(seat);
      return;
    }

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
        body.seat === "avaia" ? avaiaWalk.stance(nowMs) : undefined;
      if (stance !== undefined) proximityObserver.current?.(stance.point);
      // A manual Bond coordinate is not Avaia's location. Without an
      // independent Avaia stance, do not draw her at the Bond's declared spot.
      const handle =
        body.seat === "avaia" && stance === undefined && declaredPosition
          ? null
          : createWheelBodyHandle({
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
      if (handle !== null) {
        drawn[body.seat] = handle;
        avatarLayer.upsert(handle);
      } else hide(body.seat);
      // A walking body carries its card with it, frame by frame.
      if (avaiaWalk.moving && stance !== undefined) {
        renderer.setObservedPositionLabel(wheelLabelRef.current(stance.point));
      }

      // Only the identity in the seat this instant is on the world: the other
      // body is hidden rather than left standing behind the one driving.
      for (const seat of Object.keys(BODY_HANDLE_IDS) as DockSeat[]) {
        if (seat !== body.seat) hide(seat);
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
    };
  }, [
    avaiaAddress,
    avaiaAvatar?.appearance,
    avaiaAvatar?.modelId,
    avatarChoice?.rendered,
    avaiaWalk,
    bondAvatar?.appearance,
    cameraZoom,
    declaredPosition,
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

  // An Avaia at the wheel is focused where its body stands, which after a walk
  // is not where its Bond is.
  function focusWorldOnWheel(): void {
    if (observedPosition === undefined) return;
    const avaiaPoint = wheelAvaiaPoint();
    const target =
      avaiaPoint === undefined
        ? observedPosition
        : { ...observedPosition, ...avaiaPoint };
    const context = { presentation, dimension, safeArea };
    renderer.setCamera(closeUpCamera(target, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  /**
   * The pair has two meanings, one per side. The identity at the wheel brings
   * the world to it; the one spectating takes the wheel from it.
   */
  function activateDockIdentity(identity: DockIdentityViewState): void {
    // A tap on the Dock is felt where the host can say so: Telegram's haptics,
    // a vibration pulse, Safari's switch tick — or nothing at all.
    try {
      feedback?.impact("light");
    } catch {
      // Feedback is presentation; it never stands between a tap and its act.
    }
    cue("tap");
    switch (identity.intent) {
      case "focus":
        focusWorldOnWheel();
        return;
      case "configure":
        openDetail("avaia");
        return;
      case "wheel":
        activateSpectator();
        return;
    }
  }

  /** The Dock's own action configures whoever is currently driving. */
  function activateConfigure(): void {
    if (dock.configure.seat === "avaia") {
      openDetail("avaia");
      return;
    }
    navigate(IDENTITY_ROUTE);
  }

  // How full the driver's state is, drawn inside the bag: the Avaia's energy
  // while Core reports it, else how far the driver is towards the next level.
  const statusFill =
    dock.configure.seat === "avaia" && avaiaLife !== undefined
      ? avaiaLife.energy / 10_000
      : levelFill(
          dock.configure.seat === "avaia" ? standing.avaia : standing.bond,
          dock.configure.seat,
        );

  /**
   * The Dock's other action opens what whoever is driving carries, under
   * their own state: the Bond's, or the Avaia's.
   */
  function activateInventory(): void {
    openDetail("inventory", dock.configure.seat);
  }

  /**
   * A save ends on the world. The service answers with what it stored, that
   * answer is what the surface already reads, and only then does the screen
   * close — so nothing here confirms a draft the service never saw. The world
   * underneath was never a screen to come back to; it stayed mounted.
   */
  async function submitAvaiaSetup(): Promise<void> {
    const firstConfiguration = avaiaConfiguration === "unconfigured";
    const offeredBody = avaiaAvatar;
    const result = await onAvaiaSetupSubmit?.();
    if (result?.kind !== "updated") return;
    setDetailState(undefined);
    setAvaiaSavedToast({
      id: `avaia-saved:${result.profile.pubDress}`,
      kind: "active",
      title: t("dock.avaiaSaved"),
      description: result.profile.pubDress,
    });
    if (
      !firstConfiguration ||
      result.profile.configurationState !== "configured"
    ) {
      return;
    }
    // The body the setup offered is the one that was accepted, so it becomes a
    // choice this device remembers under the address the service stored.
    if (offeredBody !== undefined) {
      commitAvatar({
        subject: "avaia",
        address: result.profile.pubDress,
        selection: offeredBody,
        modelIsLocal: true,
      });
    }
    // She comes back to say what it paid.
    const current = progressionSnapshot(pubDress);
    guide.play("reward", {
      reward: {
        achievement: "avaia-configured",
        before: progressionStanding(current, { avaiaConfigured: false }),
        after: progressionStanding(current, { avaiaConfigured: true }),
        ...(localModel !== undefined &&
        !current.deviceAchievements.includes("avaia-model-downloaded")
          ? { next: "download" as const }
          : {}),
      },
    });
  }

  /**
   * How a scene with xSasha ended is all the world hears of it. An
   * introduction played through or skipped is not played again on this
   * device; one put off comes back the next time the world opens.
   */
  function endGuideScene(
    scene: GuideSceneId,
    outcome: GuideOutcome,
    result: GuidePlayOptions,
  ): void {
    sceneSequence.current += 1;
    const toast = guideResultToast(
      `scene:${sceneSequence.current}`,
      scene,
      outcome,
      result,
      t,
      { bond: pubDress, avaia: avaiaLabel },
    );
    setSceneToasts((current) => [...current, toast]);
    if (scene === "intro") {
      if (outcome === "later") postponeGuideIntro(pubDress);
      else {
        rememberGuideIntro(
          pubDress,
          outcome === "skipped" ? "skipped" : "done",
        );
      }
      if (outcome === "create") openDetail("avaia");
      return;
    }
    // The Bond and its new Avaia take it from here: the Avaia arrives on the
    // world. Nothing is fetched for it — a reply to her is not the gesture
    // that asks a device to download a model.
    if (outcome === "together" && wheel === "bond") handWheel("avaia");
  }

  /** The model is on this device: the download achievement pays, once. */
  function earnModelDownloaded(): void {
    const current = progressionSnapshot(pubDress);
    if (current.deviceAchievements.includes("avaia-model-downloaded")) return;
    const next = updateProgression(pubDress, (progression) =>
      earnDeviceAchievement(progression, "avaia-model-downloaded"),
    );
    cue("achievement");
    setAchievementDialog({
      achievement: "avaia-model-downloaded",
      before: progressionStanding(current, accountFacts),
      after: progressionStanding(next, accountFacts),
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
    handWheel(wheel === "bond" ? "avaia" : "bond");
  }

  function handWheel(to: DockSeat): void {
    // Switching control changes neither identity's position. Freeze an
    // interrupted walk where the Avaia actually stands, including handover.
    const avaiaPoint = avaiaWalk.stop();
    setHandover({ from: wheel, to, startedMs: globalThis.performance.now() });
    setChosenWheel(to);

    if (observedPosition === undefined) return;
    const context = { presentation, dimension, safeArea };
    const target =
      to === "avaia" && avaiaPoint !== undefined
        ? { ...observedPosition, ...avaiaPoint }
        : observedPosition;
    renderer.setCamera(bodyVisibleCamera(target, camera, context), {
      motion: cameraMotion(prefersReducedMotion()),
      padding: locationCameraPadding(context),
    });
    cameraMovedByPerson.current = false;
  }

  /**
   * The Bond said yes: the Avaia walks up to the cell's edge, on open ground,
   * and starts on it from there. It never walks into the fog.
   */
  function confirmFogReveal(): void {
    const job = fogReveal.confirm();
    if (job === undefined) return;
    if (wheel === "avaia" && handover === undefined) {
      const body = avaiaWalk.stance(globalThis.performance.now())?.point;
      avaiaWalk.walkTo(fogReveal.approach(job.cell, body));
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
      // never saved does not survive the way out. Cancel says so on its face;
      // the way back is navigation, so it asks once before it throws away
      // something a person actually changed.
      if (
        !avatarLeaveAsked &&
        !avatarSaving &&
        avatarDraft !== undefined &&
        avatarDraftOpened !== undefined &&
        draftMovedFrom(avatarDraft, avatarDraftOpened)
      ) {
        setAvatarLeaveAsked(true);
        return;
      }
      closeAvatarEditor();
      return;
    }
    setDetailState(undefined);
  }

  function detailEyebrow(): string {
    if (activeDetail === "avatar") {
      return detailState?.subject === "avaia" ? avaiaLabel : pubDress;
    }
    if (activeDetail === "avaia") return t("dock.ownedAvaia");
    if (activeDetail === "inventory" && detailState?.subject === "avaia") {
      return t("dock.ownedAvaia");
    }
    if (section === "settings") return t("settings.application");
    return t("dock.personalBond");
  }

  function detailTitle(): string {
    switch (activeDetail) {
      case "providers":
        return t("dock.providers");
      case "avatar":
        return t("dock.threeDModel");
      case "avaia":
        return avaiaLabel;
      case "inventory":
        return t("inventory.title");
      case undefined:
        return section === "settings" ? t("header.settings") : pubDress;
    }
  }

  /** The Dock names itself by the screen it is presenting. */
  function dockTitle(): string {
    return section === "world" ? "Bond" : detailTitle();
  }

  /** The header's small title: the section being read, else the screen. */
  function dockHeaderTitle(): string {
    return dockSectionTitle ?? detailTitle();
  }

  function handleDockScroll(event: UIEvent<HTMLElement>): void {
    setDockSectionTitle(passedSectionTitle(event.currentTarget));
  }

  return (
    <AppShell
      className="authenticated-map-home"
      presentation={presentation}
      safeArea={safeArea}
      data-theme={resolvedAppearance}
      data-focus-state={focusState}
      data-readiness={readiness.tone}
      data-readiness-shown={readinessShown}
      frame={<div className="authenticated-map-home__readiness" />}
      data-section={section}
      data-cutscene={guideActive}
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
          settingsAttention={settingsAttention}
          onNavigate={navigate}
        />
      }
      toasts={
        <StatusToastStack
          toasts={statusToasts}
          label={t("shell.worldStatus")}
          placement="inline"
          copy={{
            readMore: t("toast.readMore"),
            readLess: t("toast.readLess"),
            dismiss: t("toast.dismiss"),
          }}
          onDismiss={(id) => {
            if (sceneToasts.some((toast) => toast.id === id)) {
              setSceneToasts((current) =>
                current.filter((toast) => toast.id !== id),
              );
              return;
            }
            if (avaiaSavedToast?.id === id) {
              setAvaiaSavedToast(undefined);
              return;
            }
            if (findToast?.id === id) {
              setFindToast(undefined);
              return;
            }
            if (speech.toasts.some((toast) => toast.id === id)) {
              speech.dismiss(id);
              return;
            }
            if (readiness.issues.some((issue) => issue.id === id)) {
              setDismissedReadiness((closed) => new Set(closed).add(id));
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
            <strong>
              {translateFirst(t, runtime.label, RUNTIME_LABEL_KEYS)}
            </strong>
            {contractVersion === undefined ? null : (
              <small>
                {t("runtime.contract").replace("{version}", contractVersion)}
              </small>
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
        >
          <DockWindow screen={dockScreen} depth={dockDepth}>
            {section === "world" && activeDetail === undefined ? (
              <>
                <div className="bond-dock__header">
                  <span className="bond-dock__kicker">Bond</span>
                  <div className="bond-dock__header-actions">
                    {inventoryReady ? (
                      <button
                        className="bond-dock__edit bond-dock__status"
                        type="button"
                        data-seat={dock.configure.seat}
                        aria-label={t("inventory.openNamed").replace(
                          "{name}",
                          dock.configure.seat === "avaia"
                            ? avaiaLabel
                            : pubDress,
                        )}
                        onClick={activateInventory}
                      >
                        <StatusGlyph fill={statusFill} />
                      </button>
                    ) : null}
                    <button
                      className="bond-dock__edit"
                      type="button"
                      aria-label={translateFirst(
                        t,
                        dock.configure.label,
                        DOCK_ACTION_KEYS,
                      )}
                      onClick={activateConfigure}
                    >
                      {t("dock.edit")}
                    </button>
                  </div>
                </div>
                <div className="bond-dock__scroll">
                  <div className="bond-dock__pair">
                    <DockPlaceButton
                      place={dock.places[0]}
                      onActivate={activateDockIdentity}
                    />
                    <span
                      className="bond-dock__link"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("dock.noRelationship")}
                    />
                    <DockPlaceButton
                      place={dock.places[1]}
                      onActivate={activateDockIdentity}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="bond-dock__detail">
                <div className="bond-dock__detail-header">
                  <button
                    className="interface-settings__back"
                    type="button"
                    aria-label={t("settings.back")}
                    onClick={leaveDetail}
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <div>
                    <span className="interface-settings__eyebrow">
                      {detailEyebrow()}
                    </span>
                    <h2>
                      {/* Keyed by what it says, so a new section's name
                        arrives rather than being swapped in place. */}
                      <span
                        className="bond-dock__detail-header-title"
                        key={dockHeaderTitle()}
                      >
                        {dockHeaderTitle()}
                      </span>
                    </h2>
                  </div>
                </div>
                <div className="bond-dock__scroll" onScroll={handleDockScroll}>
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
                            state={createAvatarFieldViewState(
                              "bond",
                              bondAvatar,
                            )}
                            onOpen={() => openAvatarEditor("bond")}
                          />
                          <p className="profile-edit__note">
                            {avatarChoice.unsupportedModel !== undefined
                              ? t("dock.unsupportedStudy").replace(
                                  "{model}",
                                  avatarChoice.unsupportedModel,
                                )
                              : avatarChoice.unchosen
                                ? t("dock.noStudy")
                                : t("dock.studies")}
                          </p>
                          {avatarChoice.error === undefined ? null : (
                            <p className="profile-edit__error" role="alert">
                              {translateCopy(t, avatarChoice.error)}
                            </p>
                          )}
                        </div>
                      )}
                      <section
                        className="avaia-notebook"
                        aria-labelledby="bond-progression-title"
                      >
                        <span
                          className="interface-settings__eyebrow"
                          id="bond-progression-title"
                        >
                          {t("avaia.progression.title")}
                        </span>
                        <p className="profile-edit__note">
                          {levelSummary(t, standing.bond)}
                        </p>
                      </section>
                      <dl className="bond-profile__rows">
                        {!inventoryReady ? null : (
                          <div>
                            <dt>{t("inventory.open")}</dt>
                            <dd>
                              <button
                                className="provider-control"
                                type="button"
                                onClick={() => openDetail("inventory")}
                              >
                                {t("inventory.open")}
                              </button>
                            </dd>
                          </div>
                        )}
                        <div>
                          <dt>{t("dock.providers")}</dt>
                          <dd>
                            {providers === undefined ? (
                              <small
                                className="profile-edit__note"
                                role="status"
                              >
                                {t("dock.loading")}
                              </small>
                            ) : (
                              <span className="provider-controls">
                                {providers.connected.map((row) => (
                                  <ProviderMark key={row.provider} row={row} />
                                ))}
                                <button
                                  className="provider-control provider-control--add"
                                  type="button"
                                  aria-label={t("dock.addProvider")}
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
                          {...(downloadPending
                            ? {
                                attention: {
                                  bondXp:
                                    ACHIEVEMENTS["avaia-model-downloaded"]
                                      .bondXp,
                                  avaiaXp:
                                    ACHIEVEMENTS["avaia-model-downloaded"]
                                      .avaiaXp,
                                },
                              }
                            : {})}
                          onModelPresent={earnModelDownloaded}
                        />
                      )}
                      {/* Hidden for now — uncomment together with the import above.
                    <BondArtificialPositionSettings
                      ownerPubDress={pubDress}
                      renderer={renderer}
                    />
                    */}
                      <fieldset className="interface-settings__appearance">
                        <legend>{t("settings.appearance.legend")}</legend>
                        <SettingsSlider
                          id="appearance-level"
                          label={t("settings.appearance.legend")}
                          options={(
                            [
                              [
                                "light",
                                "settings.appearance.light",
                                "settings.appearance.lightDetail",
                              ],
                              [
                                "auto",
                                "settings.appearance.auto",
                                "settings.appearance.autoDetail",
                              ],
                              [
                                "dark",
                                "settings.appearance.dark",
                                "settings.appearance.darkDetail",
                              ],
                            ] as const
                          ).map(([value, label, detail]) => ({
                            value,
                            label: t(label),
                            detail: t(detail),
                          }))}
                          value={appearance.preference}
                          onChange={chooseAppearance}
                        />
                      </fieldset>
                      <fieldset className="interface-settings__appearance">
                        <legend>{t("settings.depth.legend")}</legend>
                        {(
                          [
                            [
                              "volumetric",
                              "settings.depth.threeD",
                              "settings.depth.threeDDetail",
                            ],
                            [
                              "flat",
                              "settings.depth.twoD",
                              "settings.depth.twoDDetail",
                            ],
                          ] as const
                        ).map(([mode, label, detail]) => (
                          <label
                            key={mode}
                            className="interface-settings__option"
                          >
                            <span>
                              <strong>{t(label)}</strong>
                              <small>{t(detail)}</small>
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
                      {sound === undefined ? null : (
                        <SoundSettings sound={sound} />
                      )}
                      {committedAwards === undefined ||
                      findItems?.picksUp === undefined ? null : (
                        <PickupSettings />
                      )}
                      <p className="interface-settings__note">
                        {t("settings.presentation")}
                      </p>
                    </>
                  ) : null}

                  {activeDetail === "inventory" && findItems !== undefined ? (
                    <>
                      <section
                        className="avaia-notebook"
                        aria-labelledby="inventory-state-title"
                      >
                        <span
                          className="interface-settings__eyebrow"
                          id="inventory-state-title"
                        >
                          {detailState?.subject === "avaia"
                            ? avaiaLabel
                            : pubDress}
                        </span>
                        <p className="profile-edit__note">
                          {detailState?.subject !== "avaia"
                            ? levelSummary(t, standing.bond)
                            : avaiaConfiguration === "unconfigured"
                              ? t("avaia.progression.unconfigured")
                              : levelSummary(t, standing.avaia)}
                        </p>
                        {detailState?.subject === "avaia" &&
                        avaiaLife !== undefined ? (
                          <p className="profile-edit__note">
                            {t("inventory.energy").replace(
                              "{percent}",
                              String(Math.round(avaiaLife.energy / 100)),
                            )}
                          </p>
                        ) : null}
                      </section>
                      <InventoryPanel
                        owner={pubDress}
                        core={findItems}
                        committed={committedAwards !== undefined}
                        workshop={workshop}
                        first={detailState?.subject ?? "bond"}
                      />
                    </>
                  ) : null}

                  {activeDetail === "avaia" ? (
                    <>
                      <section
                        className="avaia-notebook"
                        aria-labelledby="avaia-progression-title"
                      >
                        <span
                          className="interface-settings__eyebrow"
                          id="avaia-progression-title"
                        >
                          {t("avaia.progression.title")}
                        </span>
                        <p className="profile-edit__note">
                          {avaiaConfiguration === "unconfigured"
                            ? t("avaia.progression.unconfigured")
                            : levelSummary(t, standing.avaia)}
                        </p>
                      </section>
                      {/* A host that cannot read the Avaia's profile configures
                        nothing here; what this device noted is still its own. */}
                      {avaiaSetup === undefined ? null : (
                        <>
                          <AvaiaSetupView
                            state={avaiaSetup}
                            onDraftChange={(value) =>
                              onAvaiaSetupChange?.(value)
                            }
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
                      {avaiaWalk.favourites.length === 0 ? null : (
                        <section
                          className="avaia-notebook"
                          aria-labelledby="avaia-favourites-title"
                        >
                          <span
                            className="interface-settings__eyebrow"
                            id="avaia-favourites-title"
                          >
                            {t("avaia.favourites.title")}
                          </span>
                          <ul className="avaia-notebook__list">
                            {avaiaWalk.favourites.map((place) => (
                              <li key={place.id}>
                                <strong>
                                  {place.lovedAt === undefined ? null : (
                                    <span aria-hidden="true">♥ </span>
                                  )}
                                  {landmarkLabel(locale, placeLandmark(place))}
                                </strong>
                                <small>
                                  {[
                                    locale === "en"
                                      ? place.kind
                                      : landmarkKindLabel(locale, place.kind),
                                    ...(place.lovedAt === undefined
                                      ? []
                                      : [t("avaia.favourites.loved")]),
                                    t("avaia.favourites.visits").replace(
                                      "{count}",
                                      String(place.visits),
                                    ),
                                  ].join(" · ")}
                                </small>
                              </li>
                            ))}
                          </ul>
                        </section>
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
                                <strong>
                                  {landmarkLabel(locale, landmark)}
                                </strong>
                                <small>
                                  {[
                                    locale === "en"
                                      ? landmark.kind
                                      : landmarkKindLabel(
                                          locale,
                                          landmark.kind,
                                        ),
                                    ...Object.entries(landmark.facts)
                                      .filter(
                                        ([key]) => !key.startsWith("name"),
                                      )
                                      .map(
                                        ([key, value]) => `${key}: ${value}`,
                                      ),
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
                      <section
                        className="avaia-notebook"
                        aria-labelledby="avaia-finds-title"
                      >
                        <span
                          className="interface-settings__eyebrow"
                          id="avaia-finds-title"
                        >
                          {t("avaia.finds.title")}
                        </span>
                        {findLoop.leads.length === 0 ? (
                          <p className="profile-edit__note">
                            {t("avaia.finds.empty")}
                          </p>
                        ) : (
                          <ul className="avaia-notebook__list">
                            {findLoop.leads.map((lead) => (
                              <li key={lead.artifactId}>
                                <strong>
                                  {t("avaia.finds.leadTitle").replace(
                                    "{tier}",
                                    String(lead.tier),
                                  )}
                                </strong>
                                <small>{t("avaia.finds.leadDetail")}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="interface-settings__note">
                          {t("avaia.finds.note")}
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
                      onChooseModel={(model) => {
                        setAvatarLeaveAsked(false);
                        setAvatarDraft(chooseDraftModel(avatarDraft, model));
                      }}
                      onEquip={(itemId) => {
                        setAvatarLeaveAsked(false);
                        setAvatarDraft(equipInDraft(avatarDraft, itemId));
                      }}
                      onCancel={closeAvatarEditor}
                      onSave={() => void saveAvatarDraft()}
                      {...(avatarLeaveAsked
                        ? {
                            leaving: {
                              onStay: () => setAvatarLeaveAsked(false),
                              onDiscard: closeAvatarEditor,
                            },
                          }
                        : {})}
                    />
                  ) : null}

                  {activeDetail === "providers" ? (
                    <div className="provider-management">
                      {providers === undefined ? (
                        <p className="interface-settings__note" role="status">
                          {t("dock.loadingProviders")}
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
                                  <small>
                                    {row.status === "Not connected"
                                      ? t("dock.notConnected")
                                      : translateIf(
                                          t,
                                          "dock.connected",
                                          row.status,
                                        )}
                                  </small>
                                </span>
                                {row.connected ? (
                                  <span className="provider-management__actions">
                                    <ProviderMark
                                      row={row}
                                      label={t("dock.open")}
                                    />
                                    <button
                                      className="provider-management__disconnect"
                                      type="button"
                                      aria-label={translateCopy(
                                        t,
                                        row.disconnectLabel,
                                      )}
                                      title={translateCopy(
                                        t,
                                        row.disconnectLabel,
                                      )}
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
                                    aria-label={translateCopy(
                                      t,
                                      row.connectLabel,
                                    )}
                                  >
                                    {t("dock.connect")}
                                  </a>
                                )}
                              </li>
                            ))}
                          </ul>
                          <p className="interface-settings__note">
                            {t("dock.providerDescription")}
                          </p>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </DockWindow>
        </section>
      }
      overlay={
        <>
          <LocationControl
            viewModel={locationControl}
            proximity={
              findItems?.avaiaProximity === undefined
                ? undefined
                : (avaiaProximity?.policy ?? "unknown")
            }
            onActivate={activateLocationControl}
          />
          {travelPrompt === undefined ? (
            <FogRevealPrompt
              prompt={fogReveal.prompt}
              jobs={fogReveal.jobs}
              avaia={avaiaLabel}
              onConfirm={confirmFogReveal}
              onDismiss={fogReveal.dismiss}
            />
          ) : (
            <AvaiaTravelPrompt
              avaia={avaiaLabel}
              busy={travelBusy}
              error={travelError}
              onConfirm={() => void confirmBringAvaia()}
              onDismiss={() => {
                setTravelPrompt(undefined);
                setTravelError(false);
              }}
            />
          )}
          {guide.state === undefined ? null : (
            <GuideCutsceneView
              state={guide.state}
              bondName={pubDress}
              avaiaName={avaiaLabel}
              reducedMotion={reducedMotion}
              onChoose={guide.choose}
              onAdvance={guide.advance}
              onRewardFly={(toasts) => {
                cue("achievement");
                setRewardToasts((current) => [...current, ...toasts]);
              }}
            />
          )}
          <GuideRewardToasts
            toasts={rewardToasts}
            reducedMotion={reducedMotion}
            onExpire={(key) =>
              setRewardToasts((current) =>
                current.filter((toast) => toast.key !== key),
              )
            }
          />
          {achievementDialog === undefined ? null : (
            <AchievementDialog
              state={achievementDialog}
              bondName={pubDress}
              avaiaName={avaiaLabel}
              onClose={() => {
                endGuideScene("reward", "done", { reward: achievementDialog });
                setAchievementDialog(undefined);
              }}
            />
          )}
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
              ? t("map.focus.locating")
              : focusState === "focused"
                ? t("map.focus.focused")
                : focusState === "unavailable"
                  ? t("map.focus.unavailable")
                  : ""}
          </span>
        </>
      }
    />
  );
}
