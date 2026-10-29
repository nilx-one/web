// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapAppearance, MapCamera } from "@nilx-one/map-contract";

/**
 * What the world looked like when a person followed a Bond's public address:
 * where the camera was and in which appearance. It travels in the fragment, so
 * it never reaches a server, and the public page removes it from the address
 * as soon as it has read it. It is presentation, never a position report: the
 * camera is wherever a person was looking, not where anyone is.
 */
export interface PublicBondMapState {
  readonly camera?: MapCamera;
  readonly appearance?: MapAppearance;
}

const CAMERA_KEY = "map";
const APPEARANCE_KEY = "appearance";

function round(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

/** The public address carrying this world's camera and appearance. */
export function withPublicBondMapState(
  href: string,
  state: PublicBondMapState,
): string {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (state.camera !== undefined) {
    const { center, zoom, bearing, pitch } = state.camera;
    hash.set(
      CAMERA_KEY,
      [
        round(center[0], 6),
        round(center[1], 6),
        round(zoom, 2),
        round(bearing, 1),
        round(pitch, 1),
      ].join(","),
    );
  }
  if (state.appearance !== undefined) {
    hash.set(APPEARANCE_KEY, state.appearance);
  }
  url.hash = hash.toString();
  return url.href;
}

function readCamera(value: string | null): MapCamera | undefined {
  if (value === null) return undefined;
  const parts = value.split(",");
  if (parts.length !== 5 || parts.some((part) => part.trim() === "")) {
    return undefined;
  }
  const [longitude, latitude, zoom, bearing, pitch] = parts.map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    ![longitude, latitude, zoom, bearing, pitch].every(Number.isFinite) ||
    Math.abs(longitude) > 180 ||
    Math.abs(latitude) > 85.0511 ||
    zoom < 0 ||
    zoom > 24 ||
    pitch < 0 ||
    pitch > 85
  ) {
    return undefined;
  }
  return {
    center: [longitude, latitude],
    zoom,
    bearing:
      bearing >= 0 && bearing < 360 ? bearing : ((bearing % 360) + 360) % 360,
    pitch,
  };
}

/** Reads what a fragment carries; anything malformed is simply not there. */
export function readPublicBondMapState(fragment: string): PublicBondMapState {
  const hash = new URLSearchParams(fragment.replace(/^#/, ""));
  const camera = readCamera(hash.get(CAMERA_KEY));
  const appearance = hash.get(APPEARANCE_KEY);
  return {
    ...(camera === undefined ? {} : { camera }),
    ...(appearance === "light" || appearance === "dark" ? { appearance } : {}),
  };
}

/** The fragment with the hand-off removed, so a copied address stays clean. */
export function withoutPublicBondMapState(fragment: string): string {
  const hash = new URLSearchParams(fragment.replace(/^#/, ""));
  hash.delete(CAMERA_KEY);
  hash.delete(APPEARANCE_KEY);
  return hash.toString();
}
