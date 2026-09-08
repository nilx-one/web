// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_MODELS } from "@nilx-one/application";
import {
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

export function createSelfAvatarHandle(
  pubDress: string,
  model: PublishedAvatarModel,
  location: DeviceLocationState,
  timeMs: number,
  reducedMotion: boolean,
): AvatarHandle | null {
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
    scale: 1,
    visible: true,
  };
}
