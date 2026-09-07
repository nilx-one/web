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
}

export const DEFAULT_MAP_CAMERA: MapCamera = {
  center: [0, 0],
  zoom: 1,
  bearing: 0,
  pitch: 0,
};

export const DEFAULT_MAP_APPEARANCE: MapAppearance = "light";
export const DEFAULT_MAP_DIMENSION: MapDimension = "volumetric";
