// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AVATAR_MODELS } from "@nilx-one/application";
import {
  AVATAR_MODEL_IDS,
  MAP_SCALE_ZOOM,
  mapMetersPerPixel,
  sampleAmbientAvatar,
  type AvatarHandle,
  type AvatarModelId,
} from "@nilx-one/map-contract";

import type { DockSeat } from "./bond-dock-view-model";
import type { DeviceLocationState } from "./device-location";
import { deviceLocationPosition } from "./device-location";
import type { WheelBody } from "./wheel-handover";

type PublishedAvatarModel = (typeof AVATAR_MODELS)[number];

/**
 * The body of whichever identity is at the wheel, standing where this device
 * observed itself.
 *
 * It is presentation and nothing else: a body on the map is not evidence of
 * presence, not a claim about who is nearby, and never written back. The world
 * draws one at a time — the one driving — and only while an observation
 * exists. During a handover the body that is leaving and the body arriving
 * hold separate handles, so the arriving study can load while the other one
 * settles.
 */
export const BODY_HANDLE_IDS: Readonly<Record<DockSeat, string>> = {
  bond: "bond",
  avaia: "avaia",
};

/** A study is a body, not a name: an Avaia never wears its Bond's own. */
export function avaiaStudy(
  avaiaAddress: string,
  bondStudy: AvatarModelId,
): AvatarModelId {
  const others = AVATAR_MODEL_IDS.filter((model) => model !== bondStudy);
  const choice = others[avatarSeed(avaiaAddress) % others.length];
  return choice ?? bondStudy;
}

/** A deterministic seed, so the same identity keeps the same ambient rhythm. */
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

/** Everything the client needs to stand a body on the world. */
export interface WheelBodyInput {
  /** The identity this body belongs to, which is the one at the wheel. */
  readonly body: WheelBody;
  /** The address that seeds this identity's own ambient rhythm. */
  readonly address: string;
  readonly study: PublishedAvatarModel;
  readonly location: DeviceLocationState;
  /** The camera the body is being drawn under, which sets its apparent size. */
  readonly zoom: number;
  readonly timeMs: number;
  readonly reducedMotion: boolean;
}

/**
 * The body of the identity at the wheel.
 *
 * Where it stands is the one thing this client actually observed: its own
 * device position. An Avaia is not there in any sense the protocol asserts —
 * where an Avaia is will come from an integration that knows, and until one
 * does, the world can only draw it at the client's own anchor.
 */
export function createWheelBodyHandle({
  body,
  address,
  study,
  location,
  zoom,
  timeMs,
  reducedMotion,
}: WheelBodyInput): AvatarHandle | null {
  const position = deviceLocationPosition(location);
  if (position === undefined) return null;
  const ambient = sampleAmbientAvatar(
    avatarSeed(address),
    timeMs,
    reducedMotion,
  );
  // A handover is a body arriving or leaving, which is a thing it is doing —
  // so it is not left to the ambient sampler. Reduced motion still gets the
  // clip: it is what makes the change legible, and it plays once.
  const handing = body.clipId !== undefined;

  return {
    id: BODY_HANDLE_IDS[body.seat],
    // The application and the map contract publish the same study names, so a
    // chosen body needs no translation table between them.
    modelId: study as AvatarModelId,
    lngLat: [position.longitude, position.latitude],
    // Heading is not observed here, so the body faces the world's north rather
    // than pretending to know which way anyone is turned.
    bearingDeg: 0,
    clipId: handing ? body.clipId : ambient.clipId,
    clipPhase: handing ? (body.clipPhase ?? 0) : ambient.clipPhase,
    scale: avatarPresentationScale(zoom, position.latitude),
    visible: zoom >= AVATAR_MIN_ZOOM,
  };
}
