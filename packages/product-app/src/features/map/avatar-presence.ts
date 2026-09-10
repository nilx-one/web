// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  resolveAvatarScene,
  type AVATAR_MODELS,
  type AvatarAppearance,
} from "@nilx-one/application";
import {
  AVATAR_MODEL_IDS,
  MAP_BODY_HANDOVER_ZOOM,
  MAP_BODY_HEIGHT_METERS,
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
 * The height a published study stands at, which the map contract publishes so
 * that the renderer measures the reach of a body by the same number the world
 * draws it at. Every study clears it, and none is scaled up further than it
 * needs.
 */
const AVATAR_HEIGHT_METERS = MAP_BODY_HEIGHT_METERS;

/** The parallel Web Mercator stops at, and so the last latitude with ground. */
const MERCATOR_LATITUDE_LIMIT = 85.051129;

/** The height a body is drawn at, at every scale it appears on. */
export const AVATAR_APPARENT_PIXELS = 24;

/**
 * Further out than street scale an observation is a place, not a person. The
 * position marker already says "here" at those widths, and a body standing
 * there would claim a precision the observation does not have.
 *
 * It is the map contract's own threshold rather than a second copy of it: the
 * renderer hides the card by the same number the body appears at, so the two
 * take turns instead of drifting into a width that shows both or neither.
 */
export const AVATAR_MIN_ZOOM = MAP_BODY_HANDOVER_ZOOM;

/**
 * How much larger than life the body is drawn, so that it is always drawn the
 * same size.
 *
 * At building scale a person is barely three pixels tall, which is why a body
 * needs a presentation size of its own to be seen at all. It keeps that size
 * at every scale it appears on rather than growing into true scale as the
 * camera comes in: a body is who is standing there, and how big it looks
 * should not change what it is. The position is untouched — only the apparent
 * height — and the world's own geometry is unaffected.
 */
export function avatarPresentationScale(
  zoom: number,
  latitude: number,
): number {
  // Web Mercator carries no ground past this parallel, and the metres a pixel
  // covers there collapses towards zero — which would divide a body down to
  // nothing rather than draw it. The projection's own limit is the answer.
  const ground = mapMetersPerPixel(
    Math.min(
      Math.max(latitude, -MERCATOR_LATITUDE_LIMIT),
      MERCATOR_LATITUDE_LIMIT,
    ),
    zoom,
  );
  const naturalPixels = AVATAR_HEIGHT_METERS / ground;
  if (!Number.isFinite(naturalPixels) || naturalPixels <= 0) {
    return 1;
  }
  return AVATAR_APPARENT_PIXELS / naturalPixels;
}

/** Everything the client needs to stand a body on the world. */
export interface WheelBodyInput {
  /** The identity this body belongs to, which is the one at the wheel. */
  readonly body: WheelBody;
  /** The address that seeds this identity's own ambient rhythm. */
  readonly address: string;
  readonly study: PublishedAvatarModel;
  /**
   * What this identity is wearing. Absent means nothing was ever chosen, which
   * the study's own default answers — never an empty body.
   */
  readonly appearance?: AvatarAppearance | undefined;
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
  appearance,
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
  // The same resolver the settings preview and the editor draw from, so a
  // person cannot be wearing one thing in the editor and another on the world.
  const scene = resolveAvatarScene(study, appearance);

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
    visibleNodes: scene.visibleNodes,
  };
}
