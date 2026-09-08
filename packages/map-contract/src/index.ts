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
   * The avatar surface, present when this renderer draws avatars at all. The
   * application drives exactly one handle through it — the signed-in Bond's
   * own body — and an avatar on the map is never evidence of presence.
   */
  readonly avatars?: AvatarLayerContract;
}

/**
 * The published avatar studies. Each is an artistic study with the same
 * skeleton and the same clips, so choosing one changes the body a person is
 * represented by and nothing about how it moves.
 */
export type AvatarModelId = "sky-study" | "dasha-study" | "kai-study";

/** The published asset version every study is served from. */
export const AVATAR_ASSET_VERSION = "0.1.0";

/** The still image a picker shows for a study, generated from that study. */
export function avatarPreviewUrl(modelId: AvatarModelId): string {
  return `/avatars/${AVATAR_ASSET_VERSION}/${modelId}.png`;
}

export const AVATAR_MODEL_IDS: readonly AvatarModelId[] = [
  "sky-study",
  "dasha-study",
  "kai-study",
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
  readonly bearingDeg: number;
  readonly clipId: AvatarClipId;
  /** Normalized [0, 1) phase used to make deterministic loops reproducible. */
  readonly clipPhase: number;
  readonly scale: number;
  readonly visible: boolean;
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
