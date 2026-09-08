// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AVATAR_MODELS } from "@nilx-one/application";
import {
  MAP_SCALE_ZOOM,
  mapMetersPerPixel,
  sampleAmbientAvatar,
  type AvatarHandle,
  type AvatarModelId,
} from "@nilx-one/map-contract";

import type { DeviceLocationState } from "./device-location";
import { deviceLocationPosition } from "./device-location";

type PublishedAvatarModel = (typeof AVATAR_MODELS)[number];

/**
 * The Bond's own body, standing where this device observed itself.
 *
 * It is presentation and nothing else: an avatar on the map is not evidence of
 * presence, not a claim about who is nearby, and never a second identity. The
 * client draws exactly one — its own — and only while an observation exists.
 */
export const AVATAR_HANDLE_ID = "self";

/** A deterministic seed, so the same Bond keeps the same ambient rhythm. */
export function avatarSeed(pubDress: string): number {
  let value = 0x811c9dc5;
  for (const scalar of pubDress) {
    value ^= scalar.codePointAt(0) ?? 0;
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
}

/**
 * The height a published study stands at. The three studies measure 1.80 m to
 * 1.89 m from the ground, so the shortest is what the readable minimum below is
 * held against: every study clears it, none is scaled up further than it needs.
 */
const AVATAR_HEIGHT_METERS = 1.8;

/**
 * Fewer pixels than this and a body is a smear rather than a figure: too small
 * to read as a person at all, let alone to tell one study from another.
 */
export const AVATAR_MIN_APPARENT_PIXELS = 24;

/**
 * Further out than street scale an observation is a place, not a person. The
 * position marker already says "here" at those widths, and a body standing
 * there would claim a precision the observation does not have.
 */
export const AVATAR_MIN_ZOOM = MAP_SCALE_ZOOM.street;

/**
 * How much larger than life the body is drawn so it stays readable while the
 * ground under it is still far away.
 *
 * At building scale a person is barely three pixels tall, which is why the
 * body needs a presentation size of its own to be seen at all. This is that
 * size and nothing more: the position is untouched, only the apparent height,
 * and the multiplier falls to exactly 1 as soon as geography alone makes a
 * person legible. From there the body is as tall as it is — one truth, drawn
 * at the size the world actually gives it.
 */
export function avatarPresentationScale(
  zoom: number,
  latitude: number,
): number {
  const naturalPixels =
    AVATAR_HEIGHT_METERS / mapMetersPerPixel(latitude, zoom);
  if (!(naturalPixels > 0) || naturalPixels >= AVATAR_MIN_APPARENT_PIXELS) {
    return 1;
  }
  return AVATAR_MIN_APPARENT_PIXELS / naturalPixels;
}

/** Everything the client needs to stand its own body on the world. */
export interface SelfAvatarInput {
  readonly pubDress: string;
  readonly model: PublishedAvatarModel;
  readonly location: DeviceLocationState;
  /** The camera the body is being drawn under, which sets its apparent size. */
  readonly zoom: number;
  readonly timeMs: number;
  readonly reducedMotion: boolean;
}

export function createSelfAvatarHandle({
  pubDress,
  model,
  location,
  zoom,
  timeMs,
  reducedMotion,
}: SelfAvatarInput): AvatarHandle | null {
  const position = deviceLocationPosition(location);
  if (position === undefined) return null;
  const ambient = sampleAmbientAvatar(
    avatarSeed(pubDress),
    timeMs,
    reducedMotion,
  );
  return {
    id: AVATAR_HANDLE_ID,
    // The application and the map contract publish the same study names, so a
    // chosen body needs no translation table between them.
    modelId: model as AvatarModelId,
    lngLat: [position.longitude, position.latitude],
    // Heading is not observed here, so the body faces the world's north rather
    // than pretending to know which way the person is turned.
    bearingDeg: 0,
    clipId: ambient.clipId,
    clipPhase: ambient.clipPhase,
    scale: avatarPresentationScale(zoom, position.latitude),
    visible: zoom >= AVATAR_MIN_ZOOM,
  };
}
