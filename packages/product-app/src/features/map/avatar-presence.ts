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
  sampleAmbientAvatar,
  type AvatarClipId,
  type AvatarHandle,
  type AvatarModelId,
  type SubscriptionAuraTier,
} from "@nilx-one/map-contract";

import type { TranslationKey } from "../../shell/localization";
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

/**
 * What a body is doing, in words, read off the clip it is drawn with — so the
 * card never says one thing while the body on the world does another.
 */
export const BODY_ACTIVITY_KEYS: Readonly<
  Record<AvatarClipId, TranslationKey>
> = {
  idle: "map.card.activity.idle",
  walk: "map.card.activity.walk",
  turn_in_place: "map.card.activity.turn",
  wake: "map.card.activity.wake",
  quiesce: "map.card.activity.quiesce",
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

/** The body an Avaia is offered while its owner is still setting it up. */
export const DEFAULT_AVAIA_STUDY: AvatarModelId = "kai-study";

/**
 * Kai, so accepting the setup as offered is one tap — unless Kai is the body
 * the Bond itself wears, in which case the ambient study stands in.
 */
export function unconfiguredAvaiaStudy(
  avaiaAddress: string,
  bondStudy: AvatarModelId,
): AvatarModelId {
  return bondStudy === DEFAULT_AVAIA_STUDY
    ? avaiaStudy(avaiaAddress, bondStudy)
    : DEFAULT_AVAIA_STUDY;
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
 * Closer than street scale — at the local-cell scale a first fix opens at — an
 * observation is a person rather than a place. Further out the position marker
 * already says "here", and a body standing there would claim a precision the
 * observation does not have.
 *
 * It is the map contract's own threshold rather than a second copy of it: the
 * renderer hides the card by the same number the body appears at, so the two
 * take turns instead of drifting into a width that shows both or neither.
 */
export const AVATAR_MIN_ZOOM = MAP_BODY_HANDOVER_ZOOM;

/**
 * A body is drawn at true human height, never larger than life. Standing beside
 * buildings drawn at their own height, anything bigger would read as a giant
 * rather than a person; a body too small to read is simply not drawn yet, and
 * the card carries it until the camera comes in.
 */
export const AVATAR_PRESENTATION_SCALE = 1;

/** Everything the client needs to stand a body on the world. */
export interface WheelBodyInput {
  /** Resolved by an authority adapter, never the local pickup preference. */
  readonly subscriptionAura?: SubscriptionAuraTier;
  readonly carry?: "pocket" | "backpack" | "bag";
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
  /**
   * Where the body stands and what it is doing when that is not simply "at
   * this device, in the ambient rhythm" — an Avaia that walked off, is walking,
   * or is looking a landmark over. A handover still outranks its clip.
   */
  readonly stance?: BodyStance | undefined;
  /** Metres above the drawn ground it stands, on a terrace or its steps. */
  readonly liftMeters?: number | undefined;
}

/** A body's own place and motion, when it has one. */
export interface BodyStance {
  readonly point: { readonly longitude: number; readonly latitude: number };
  readonly bearingDeg: number;
  /** Absent means standing there in the ambient rhythm. */
  readonly clipId?: AvatarClipId;
  readonly clipPhase?: number;
}

/**
 * The body of the identity at the wheel.
 *
 * An independent stance survives loss of the device observation. Without a
 * stance the device is the only available anchor; neither source asserts
 * protocol presence.
 */
export function createWheelBodyHandle({
  subscriptionAura,
  carry,
  body,
  address,
  study,
  appearance,
  location,
  zoom,
  timeMs,
  reducedMotion,
  stance,
  liftMeters,
}: WheelBodyInput): AvatarHandle | null {
  const position = stance?.point ?? deviceLocationPosition(location);
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
  // Reduced motion gets no stride and no turn. Route progress still advances
  // at its normal speed; only the decorative animation is suppressed.
  const moving =
    stance?.clipId !== undefined && !reducedMotion ? stance : undefined;
  // The same resolver the settings preview and the editor draw from, so a
  // person cannot be wearing one thing in the editor and another on the world.
  const scene = resolveAvatarScene(study, appearance);

  return {
    ...(subscriptionAura === undefined ? {} : { subscriptionAura }),
    subscriptionSubject: address,
    reducedMotion,
    backpack: carry === "backpack",
    id: BODY_HANDLE_IDS[body.seat],
    // The application and the map contract publish the same study names, so a
    // chosen body needs no translation table between them.
    modelId: study as AvatarModelId,
    lngLat: [position.longitude, position.latitude],
    ...(liftMeters === undefined || liftMeters <= 0 ? {} : { liftMeters }),
    // Heading is not observed here, so a body at the device faces the world's
    // north rather than pretending to know which way anyone is turned. A body
    // that walked somewhere faces the way it walked.
    bearingDeg: stance?.bearingDeg ?? 0,
    clipId: handing
      ? (body.clipId ?? "idle")
      : (moving?.clipId ?? ambient.clipId),
    clipPhase: handing
      ? (body.clipPhase ?? 0)
      : moving?.clipId !== undefined
        ? (moving.clipPhase ?? 0)
        : ambient.clipPhase,
    scale: AVATAR_PRESENTATION_SCALE,
    visible: zoom >= AVATAR_MIN_ZOOM,
    visibleNodes: scene.visibleNodes,
  };
}
