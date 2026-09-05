// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface MapCamera {
  readonly center: readonly [longitude: number, latitude: number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

// Presentation appearance only. Appearance selects a published map style
// variant; it never carries Bond, Relationship, or shared world meaning.
export type MapAppearance = "light" | "dark";

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
  setCamera(camera: MapCamera): void;
  setAppearance(appearance: MapAppearance): void;
}

export const DEFAULT_MAP_CAMERA: MapCamera = {
  center: [0, 0],
  zoom: 1,
  bearing: 0,
  pitch: 0,
};

export const DEFAULT_MAP_APPEARANCE: MapAppearance = "light";
