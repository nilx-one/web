// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface MapCamera {
  readonly center: readonly [longitude: number, latitude: number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/** Viewport chrome a camera transition must keep the target clear of. */
export interface MapCameraPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * How a camera change is presented. `immediate` is also the reduced-motion
 * equivalent of `eased`: the destination is identical, only the transition is
 * not animated.
 */
export type MapCameraMotion = "immediate" | "eased";

export interface MapCameraOptions {
  readonly motion?: MapCameraMotion;
  readonly padding?: MapCameraPadding;
}

/**
 * A camera change the renderer observed. `gesture` marks the changes a person
 * made, which is what lets presentation state stop following automatically
 * without the application guessing at intent.
 */
export interface MapCameraChange {
  readonly camera: MapCamera;
  readonly gesture: boolean;
}

// Presentation appearance only. Appearance selects a published map style
// variant; it never carries Bond, Relationship, or shared world meaning.
export type MapAppearance = "light" | "dark";

/**
 * Presentation depth only. `volumetric` lets the published style raise its
 * close-zoom building extrusion; `flat` keeps the same geography as footprints.
 * One geographic truth, two presentations of it.
 */
export type MapDimension = "flat" | "volumetric";

/**
 * The named zoom ladder the published styles and the camera policy share, so
 * city, neighborhood, street, and building scale mean one thing across the
 * renderer, the styles, and the application.
 */
export type MapScale = "city" | "neighborhood" | "street" | "building";

export const MAP_SCALE_ZOOM: Readonly<Record<MapScale, number>> = Object.freeze(
  {
    city: 11,
    neighborhood: 13,
    street: 15,
    building: 16.5,
  },
);

/**
 * The scale a body stands on the world from. A body is drawn at true human
 * height, so it only appears once the ground is close enough for a person to
 * be one: here a 1.8 m body is roughly a dozen pixels tall at mid latitudes,
 * the same local-cell scale a first fix opens at. Further out it would be a
 * speck — or, drawn larger than life, as tall as the houses beside it — so the
 * label carries the identity instead and shows the study as a still. Renderer
 * and application share this so the two never both speak, and never both fall
 * silent.
 */
export const MAP_BODY_HANDOVER_ZOOM = 18.5;

/**
 * The height a published study stands at. The three studies measure 1.80 m to
 * 1.89 m from the ground, and the shortest is what both sides hold themselves
 * against: the application scales a body against it, and the renderer measures
 * the reach of one by it.
 */
export const MAP_BODY_HEIGHT_METERS = 1.8;

/**
 * The reach of a drawn body, as a square of screen pixels around where it
 * stands. A body drawn at true height is often smaller than a fingertip, so
 * what answers a tap is this target rather than the pixels the body happens to
 * cover. It is the size interface guidance has settled on for anything a person
 * is expected to hit on a touch screen.
 */
export const MAP_BODY_TARGET_PIXELS = 44;

/** A point in the renderer's own viewport, in CSS pixels from its top left. */
export interface MapScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A geographic point chosen explicitly by a person while the map is acting as
 * an editor. It is presentation input only: it is never an observation,
 * presence evidence, BondChain fact, or Relationship state.
 */
export interface MapPointSelection {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A person reaching for a body the world is drawing.
 *
 * It says which body was reached for and nothing about what that means: the
 * renderer answers where a person pointed, and the application decides what
 * activating an identity does. Activation is presentation — it moves a camera,
 * never shared-world state.
 */
export interface MapBodyActivation {
  /** The avatar handle the activated body was drawn from. */
  readonly id: string;
}

// Web Mercator ground resolution at zoom 0 for the 512 px tile scheme both
// the renderer and the application reason in.
const EQUATOR_METERS_PER_PIXEL = 156_543.03392804097 / 2;

/**
 * Ground metres one screen pixel covers at a latitude and zoom. Renderer and
 * application share it so "geographic accuracy" and "close enough to centred"
 * mean the same distance on both sides of the contract.
 */
export function mapMetersPerPixel(latitude: number, zoom: number): number {
  return (
    (EQUATOR_METERS_PER_PIXEL * Math.cos((latitude * Math.PI) / 180)) /
    2 ** zoom
  );
}

const EARTH_RADIUS_METERS = 6_371_008.8;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle ground distance between two points. Renderer and application
 * share it so "within reach" is the same distance on both sides.
 */
export function mapDistanceMeters(
  from: MapPointSelection,
  to: MapPointSelection,
): number {
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The compass heading from one point to another: degrees clockwise from
 * north, in [0, 360). It is what `AvatarHandle.bearingDeg` means.
 */
export function mapCompassBearing(
  from: MapPointSelection,
  to: MapPointSelection,
): number {
  const phi1 = radians(from.latitude);
  const phi2 = radians(to.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

/**
 * A device observation supplied by the application. It carries presentation
 * geometry and nothing else: the renderer never learns who is observed, never
 * requests a position, and never turns one into shared-world truth.
 */
export interface MapObservedPosition {
  readonly center: readonly [longitude: number, latitude: number];
  /** Horizontal uncertainty, rendered as geographic uncertainty. */
  readonly accuracyMeters: number;
}

/**
 * Display text for the observed position, supplied separately from the
 * geographic observation. It means "this client's observed device position",
 * never a persisted or shared assertion of presence.
 */
export interface MapObservedPositionLabel {
  readonly title: string;
  readonly detail?: string;
  /**
   * Where the card stands when the body at the wheel stands somewhere other
   * than the observation — an Avaia that walked off. Absent means over the
   * observation itself.
   */
  readonly at?: readonly [longitude: number, latitude: number];
  /**
   * A line the body at the wheel is saying to itself. While present the card
   * opens beneath the title to carry it and stays shown at every scale, the
   * body's own included: it is who is talking, not a second marker. It is
   * presentation copy the application already localized, never a message
   * sent anywhere.
   */
  readonly speech?: string;
  /**
   * A still of the study standing here, shown beside the text once the body
   * itself is too small to read. It is the same body, at a size that survives
   * the distance — never a second identity, and never a claim of its own.
   */
  readonly avatarUrl?: string;
}

/**
 * What the ground under a tap is, as far as the renderer can tell from what it
 * paints. `open` is somewhere a body could walk to; the rest say why not.
 * `fog` is ground this device has not revealed yet: the renderer only reports
 * it when its composition gave it a way to know.
 */
export type MapGround = "open" | "building" | "water" | "fog";

/**
 * A person tapping the world itself — not a body, not an editor point. The
 * renderer reports where and what is painted there; the application decides
 * what that means. It is presentation input, never presence evidence.
 */
export interface MapGroundTap {
  readonly longitude: number;
  readonly latitude: number;
  readonly ground: MapGround;
}

/**
 * A point of interest the basemap already draws that is worth walking up to —
 * a monument, a memorial, an artwork. It is what the published archive says
 * about a place, read locally: never protocol state, never a claim that anyone
 * was there, and never a landmark projection in the sense of the map
 * architecture.
 */
export interface MapLandmark {
  /** Stable for the same feature across tiles and sessions. */
  readonly id: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly kind: string;
  readonly name?: string;
  /**
   * The remaining attributes the archive declares for this feature, verbatim.
   * What a body "learns" about a landmark is exactly this and nothing more.
   */
  readonly facts: Readonly<Record<string, string | number | boolean>>;
}

/**
 * Ground a body walks around rather than through: a building footprint or a
 * stretch of water, as the basemap draws it. Each polygon is its rings in
 * `[longitude, latitude]` order, outer ring first and holes after — a
 * courtyard inside a block is open ground.
 */
export interface MapObstacle {
  readonly kind: "building" | "water";
  readonly polygons: readonly (readonly (readonly (readonly [
    number,
    number,
  ])[])[])[];
}

/** A geographic box, west to east and south to north. */
export interface MapBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * One cell of the fog, as the composition that draws the fog cuts it. The id
 * is opaque to the application: it is compared and handed back, never decoded.
 * The geometry is presentation only.
 */
export interface MapFogCell {
  readonly id: string;
  readonly center: MapPointSelection;
  /** The outline, as `[longitude, latitude]` pairs, not closed. */
  readonly boundary: readonly (readonly [
    longitude: number,
    latitude: number,
  ])[];
}

/**
 * The fog this device draws over the world, and what has lifted it.
 *
 * Ground lifts in two ways. This device's own presence journal lights the
 * cells it dwelt in; and an Avaia sent to a cell at the edge of that ground,
 * or this device observing itself inside one, reveals it. A reveal is local
 * presentation state on this device: it is never presence evidence, never a
 * visit, never sent anywhere, and it asserts nothing about any Bond.
 */
export interface MapFogField {
  /**
   * False while the composition cannot say what is revealed — the journal is
   * loading, or could not load. No fog is drawn then, so none is offered.
   */
  isActive(): boolean;
  cellAt(point: MapPointSelection): MapFogCell;
  isRevealed(cellId: string): boolean;
  /**
   * The unrevealed cells a Bond standing at `point` can reach into: its own
   * cell and its neighbours, and every cell within `rings` of it that touches
   * ground already revealed. Nearest first.
   */
  frontier(point: MapPointSelection, rings: number): readonly MapFogCell[];
  /** Lifts the fog from one cell on this device. Idempotent. */
  reveal(cellId: string): void;
  /** Notifies when a cell was revealed, by either path. */
  subscribe(listener: () => void): () => void;
  /**
   * Which Bond's reveals this field reads and writes. A composition that
   * persists reveals on this device (`map-shade`'s) keeps one cell set per
   * owner and switches which one `isRevealed`/`reveal` touch; until this is
   * called at least once it keeps reveals in memory only, so a device never
   * writes a completed reveal under the wrong Bond, or reads another Bond's.
   * A composition with nothing to persist may omit this.
   */
  bindOwner?(owner: string): void;
}

/**
 * A fog cell the application wants marked on the world: one a Bond may send
 * its Avaia into, or one being revealed right now and how far along it is.
 */
export interface MapFogMark {
  readonly cell: MapFogCell;
  readonly state: "available" | "revealing";
  /** 0 to 1, for a cell being revealed. */
  readonly progress?: number;
}

export type MapRendererStatus =
  | { readonly kind: "unmounted" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready" }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface MapRenderer {
  mount(container: HTMLElement): void;
  unmount(): void;
  getStatus(): MapRendererStatus;
  subscribe(listener: (status: MapRendererStatus) => void): () => void;
  getCamera(): MapCamera;
  setCamera(camera: MapCamera, options?: MapCameraOptions): void;
  subscribeCamera(listener: (change: MapCameraChange) => void): () => void;
  setAppearance(appearance: MapAppearance): void;
  setDimension(dimension: MapDimension): void;
  setObservedPosition(position: MapObservedPosition | null): void;
  setObservedPositionLabel(label: MapObservedPositionLabel | null): void;
  /**
   * Shows the current editor point without conflating it with the observed
   * device position. Optional because non-interactive renderers need not expose
   * map editing at all.
   */
  setSelectionPoint?(point: MapPointSelection | null): void;
  /**
   * While at least one listener is present, a map tap selects geography instead
   * of activating a body. The application owns the meaning and persistence of
   * the selected point.
   */
  subscribePointSelection?(
    listener: (point: MapPointSelection) => void,
  ): () => void;
  /**
   * The avatar surface, present when this renderer draws avatars at all. The
   * application drives exactly one handle through it — the signed-in Bond's
   * own body — and an avatar on the map is never evidence of presence.
   */
  readonly avatars?: AvatarLayerContract;
  /**
   * Notifies when a person activates a body this renderer drew. Absent on a
   * renderer that draws no bodies, or draws them where nothing can be pointed
   * at — an application that finds it absent simply offers the same outcome
   * from the interface it already has.
   */
  subscribeBodyActivation?(
    listener: (activation: MapBodyActivation) => void,
  ): () => void;
  /**
   * Notifies when a person taps the world where no body is drawn and no
   * editor is listening. Point selection and body activation keep precedence.
   */
  subscribeGroundTap?(listener: (tap: MapGroundTap) => void): () => void;
  /**
   * The landmarks the basemap carries within a radius of a point, nearest
   * first. It reads tiles already loaded for the current view and nothing
   * else: no request is made on its behalf, so a place off the loaded map
   * answers with nothing rather than a guess.
   */
  landmarksNear?(
    point: MapPointSelection,
    radiusMeters: number,
  ): readonly MapLandmark[];
  /**
   * Notifies when what `landmarksNear` can answer may have changed: the map
   * has settled after loading what the current view needs. A position known
   * before its tiles arrive is asked again then, rather than missed.
   */
  subscribeLandmarksChanged?(listener: () => void): () => void;
  /**
   * The buildings and water the basemap carries that touch a box. Like
   * `landmarksNear` it reads only tiles already loaded, so ground the map has
   * not loaded answers with nothing: a walk there goes straight, as it would
   * on a renderer that cannot answer at all.
   */
  obstaclesWithin?(bounds: MapBounds): readonly MapObstacle[];
  /**
   * The fog this renderer draws, when its composition draws one. Absent means
   * there is no fog: nothing is offered to reveal and no tap is `fog`.
   */
  readonly fog?: MapFogField;
  /** Marks fog cells on the world; an empty list clears them. */
  setFogMarks?(marks: readonly MapFogMark[]): void;
}

/**
 * The published avatar studies. Each is an artistic study with the same
 * skeleton and the same clips, so choosing one changes the body a person is
 * represented by and nothing about how it moves.
 */
export type AvatarModelId =
  "sky-study" | "dasha-study" | "kai-study" | "dasha-v2-study";

/** The original studies retain their immutable published paths. */
export const AVATAR_ASSET_VERSION = "0.1.0";

export const AVATAR_ASSET_VERSIONS: Readonly<Record<AvatarModelId, string>> = {
  "sky-study": AVATAR_ASSET_VERSION,
  "dasha-study": AVATAR_ASSET_VERSION,
  "kai-study": AVATAR_ASSET_VERSION,
  "dasha-v2-study": "0.3.0",
};

/** The still image a picker shows for a study, generated from that study. */
export function avatarPreviewUrl(modelId: AvatarModelId): string {
  return `/avatars/${AVATAR_ASSET_VERSIONS[modelId]}/${modelId}.png`;
}

/**
 * The still a wardrobe shows for one item, generated from that item on this
 * body. A picker never stands a swatch in for cloth nobody rendered, so the
 * path is derived from the item's own semantic id rather than authored beside
 * it — an item with no still is a missing file, not a silently different one.
 */
export function avatarWardrobeThumbnailUrl(
  modelId: AvatarModelId,
  itemId: string,
): string {
  const slug = itemId.replaceAll("/", "-");
  return `/avatars/${AVATAR_ASSET_VERSIONS[modelId]}/${modelId}.${slug}.png`;
}

/**
 * The rigged geometry a study is drawn from. Every consumer resolves it here,
 * so settings, the editor and the world can never be looking at different
 * bytes for the same chosen body.
 */
export function avatarAssetUrl(modelId: AvatarModelId): string {
  return `/avatars/${AVATAR_ASSET_VERSIONS[modelId]}/${modelId}.glb`;
}

export const AVATAR_MODEL_IDS: readonly AvatarModelId[] = [
  "sky-study",
  "dasha-study",
  "kai-study",
  "dasha-v2-study",
];
export type AvatarClipId =
  "idle" | "walk" | "turn_in_place" | "wake" | "quiesce";

/**
 * Local presentation state for one avatar. It is not evidence of presence,
 * proximity, consent, or Relationship state. Callers may only create handles
 * from authority they already possess.
 */
export interface AvatarHandle {
  readonly id: string;
  readonly modelId: AvatarModelId;
  readonly lngLat: readonly [longitude: number, latitude: number];
  readonly altitudeMeters?: number;
  /** The way the body faces: degrees clockwise from north, as a compass reads. */
  readonly bearingDeg: number;
  readonly clipId: AvatarClipId;
  /** Normalized [0, 1) phase used to make deterministic loops reproducible. */
  readonly clipPhase: number;
  readonly scale: number;
  readonly visible: boolean;
  /**
   * The mesh nodes of this study's asset that this body draws, resolved by the
   * application from what the person is wearing. Absent — or empty — means the
   * asset is drawn exactly as it was authored, which is what a single sculpted
   * study is. The renderer only shows and hides what it is given names for: it
   * never decides what an outfit is, and never reads appearance state.
   */
  readonly visibleNodes?: readonly string[];
}

/**
 * Dependency-free avatar presentation boundary. Camera state flows one way from
 * the map into the avatar renderer; this surface never owns or mutates camera
 * state and never publishes viewport or position telemetry.
 */
export interface AvatarLayerContract {
  upsert(handle: AvatarHandle): void;
  remove(id: string): void;
  setCamera(camera: MapCamera): void;
}

export const DEFAULT_MAP_CAMERA: MapCamera = {
  center: [0, 0],
  zoom: 1,
  bearing: 0,
  pitch: 0,
};

export const DEFAULT_MAP_APPEARANCE: MapAppearance = "light";
export const DEFAULT_MAP_DIMENSION: MapDimension = "volumetric";

const AMBIENT_CLIPS: readonly AvatarClipId[] = [
  "idle",
  "walk",
  "turn_in_place",
];
const AMBIENT_SLOT_MS = 8_000;

export interface AmbientAvatarSample {
  readonly clipId: AvatarClipId;
  readonly clipPhase: number;
}

/** Pure, offline ambient sampling. No inference and no network input. */
export function sampleAmbientAvatar(
  seed: number,
  timeMs: number,
  reducedMotion = false,
): AmbientAvatarSample {
  if (reducedMotion) {
    return { clipId: "idle", clipPhase: 0 };
  }
  const slot = Math.floor(Math.max(0, timeMs) / AMBIENT_SLOT_MS);
  let value = (seed ^ Math.imul(slot + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const clipId = AMBIENT_CLIPS[(value >>> 0) % AMBIENT_CLIPS.length] ?? "idle";
  return {
    clipId,
    clipPhase: (Math.max(0, timeMs) % AMBIENT_SLOT_MS) / AMBIENT_SLOT_MS,
  };
}
