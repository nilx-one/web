// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  mapDistanceMeters,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import type { ObservedGeolocation } from "@nilx-one/host-contract";

/** A genuine journey, well beyond GPS jitter and local walks. */
export const AVAIA_TRAVEL_AWAY_METERS = 2_000;
/** Separate return threshold gives the decision hysteresis. */
export const AVAIA_TRAVEL_RETURN_METERS = 600;
export const AVAIA_TRAVEL_MAX_ACCURACY_METERS = 100;
export const AVAIA_TRAVEL_MAX_FIX_AGE_MS = 120_000;

/**
 * A physical position is evidence; a manually declared position is not.
 * A return home re-arms the single question for a future journey, while
 * neither a stale fix nor GPS jitter can open it.
 */
export function avaiaTravelDecision(input: {
  readonly home: MapPointSelection | undefined;
  readonly observation: ObservedGeolocation | undefined;
  readonly askedAway: boolean;
  readonly nowMs: number;
}): "ask" | "reset" | "hold" {
  const { home, observation, askedAway, nowMs } = input;
  if (
    home === undefined ||
    observation === undefined ||
    observation.declared === true ||
    !Number.isFinite(observation.accuracyMeters) ||
    observation.accuracyMeters < 0 ||
    observation.accuracyMeters > AVAIA_TRAVEL_MAX_ACCURACY_METERS ||
    !Number.isFinite(observation.observedAt) ||
    observation.observedAt > nowMs + 5_000 ||
    nowMs - observation.observedAt > AVAIA_TRAVEL_MAX_FIX_AGE_MS
  ) {
    return "hold";
  }

  const distance = mapDistanceMeters(home, observation);
  if (!Number.isFinite(distance)) return "hold";
  if (distance <= AVAIA_TRAVEL_RETURN_METERS) return "reset";
  if (distance >= AVAIA_TRAVEL_AWAY_METERS && !askedAway) return "ask";
  return "hold";
}
