// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MovementState, WorldPosition } from "@nilx-one/application";
import {
  AVATAR_MODEL_IDS,
  sampleAmbientAvatar,
  type AvatarHandle,
  type AvatarModelId,
} from "@nilx-one/map-contract";

import {
  avatarPresentationScale,
  avatarSeed,
  AVATAR_MIN_ZOOM,
} from "./avatar-presence";

/**
 * The Avaia's own body.
 *
 * An Avaia is this Bond's own AI counterpart, so its position is local
 * presentation the client composes for itself — never a shared-world fact,
 * never an assertion that anybody is at a place, and never written back. It
 * accompanies its Bond because that is what it is: the address the domain
 * already says follows its owner.
 */
export const AVAIA_HANDLE_ID = "avaia";

/** Close enough to read as together, far enough not to stand inside its Bond. */
const AVAIA_STANDOFF_METERS = 3;

const METERS_PER_LATITUDE_DEGREE = 111_320;

/** One stride of the walk clip, which is what the phase is measured against. */
const STRIDE_MS = 1_000;

/** A study is a body, not a name: an Avaia never wears its Bond's own. */
export function avaiaStudy(
  avaiaAddress: string,
  bondStudy: AvatarModelId,
): AvatarModelId {
  const others = AVATAR_MODEL_IDS.filter((model) => model !== bondStudy);
  const choice = others[avatarSeed(avaiaAddress) % others.length];
  return choice ?? bondStudy;
}

/**
 * Where an Avaia stands beside its Bond. The bearing comes from its own
 * address, so one Avaia keeps one side rather than jumping around its Bond
 * between observations.
 */
export function avaiaStandpoint(
  bond: WorldPosition,
  avaiaAddress: string,
): WorldPosition {
  const bearing = ((avatarSeed(avaiaAddress) % 360) * Math.PI) / 180;
  const latitudeMeters = Math.cos(bearing) * AVAIA_STANDOFF_METERS;
  const longitudeMeters = Math.sin(bearing) * AVAIA_STANDOFF_METERS;
  const longitudeScale = Math.max(
    Math.cos((bond.latitude * Math.PI) / 180),
    1e-6,
  );

  return {
    latitude: bond.latitude + latitudeMeters / METERS_PER_LATITUDE_DEGREE,
    longitude:
      bond.longitude +
      longitudeMeters / (METERS_PER_LATITUDE_DEGREE * longitudeScale),
  };
}

/** Which way a body faces while it is walking somewhere. */
export function headingDegrees(from: WorldPosition, to: WorldPosition): number {
  const toRadians = Math.PI / 180;
  const deltaLongitude = (to.longitude - from.longitude) * toRadians;
  const fromLatitude = from.latitude * toRadians;
  const toLatitude = to.latitude * toRadians;
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude);
  const x =
    Math.cos(fromLatitude) * Math.sin(toLatitude) -
    Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

export interface AvaiaAvatarInput {
  readonly avaiaAddress: string;
  readonly study: AvatarModelId;
  readonly movement: MovementState;
  /** The camera the body is drawn under, which sets its apparent size. */
  readonly zoom: number;
  readonly timeMs: number;
  readonly reducedMotion: boolean;
  /** The heading a standing body keeps, so arriving does not spin it around. */
  readonly facingDegrees?: number;
}

/**
 * The body an Avaia is drawn as. It walks while it is going somewhere and
 * settles into the same ambient rhythm as any other body once it arrives.
 */
export function createAvaiaAvatarHandle({
  avaiaAddress,
  study,
  movement,
  zoom,
  timeMs,
  reducedMotion,
  facingDegrees = 0,
}: AvaiaAvatarInput): AvatarHandle {
  // Striding is walking a body is actually doing. Reduced motion is a request
  // for none of it, so such a body stands with the others rather than
  // marching in place at its own destination.
  const striding = movement.kind === "moving" && !reducedMotion;
  const ambient = sampleAmbientAvatar(
    avatarSeed(avaiaAddress),
    timeMs,
    reducedMotion,
  );

  return {
    id: AVAIA_HANDLE_ID,
    modelId: study,
    lngLat: [movement.position.longitude, movement.position.latitude],
    bearingDeg:
      striding && movement.kind === "moving"
        ? headingDegrees(movement.position, movement.target)
        : facingDegrees,
    // Walking is a fact about this body's own movement, so it is not left to
    // the ambient sampler. Standing still, it shares the sampler every other
    // body uses, and reduced motion holds it still exactly the same way.
    clipId: striding ? "walk" : ambient.clipId,
    clipPhase: striding ? (timeMs % STRIDE_MS) / STRIDE_MS : ambient.clipPhase,
    scale: avatarPresentationScale(zoom, movement.position.latitude),
    visible: zoom >= AVATAR_MIN_ZOOM,
  };
}
