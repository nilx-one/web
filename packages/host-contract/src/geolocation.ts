// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Host-mediated device geolocation.
 *
 * An observed position is ephemeral evidence local to one host session. It can
 * drive local presentation, but it is never Bond, BondChain, Relationship, or
 * shared-world truth, it is never persisted, and it never reaches a backend,
 * analytics, or an error report.
 *
 * The canonical contract stays free of DOM types so a native host can
 * implement it without a browser.
 */

/**
 * The best-known capability state. `prompt` means the host may still ask; it
 * does not promise that asking will succeed on this platform.
 */
export type GeolocationPermission =
  "unsupported" | "prompt" | "granted" | "denied";

export interface ObservedGeolocation {
  readonly longitude: number;
  readonly latitude: number;
  /** Horizontal uncertainty of this observation. */
  readonly accuracyMeters: number;
  /** Host clock reading for the observation, in milliseconds. */
  readonly observedAt: number;
  /**
   * Set when this is not an observation at all but a point the Bond declared
   * as its location (a manual `Bond.location`). It stands the Bond there for
   * presentation and nothing else: it is never presence evidence, a presence
   * adapter ignores it, and nothing about the device is inferred from it.
   */
  readonly declared?: true;
}

/**
 * Semantic failure reasons. A provider error never leaves the adapter: feature
 * code reads these and nothing else.
 */
export type GeolocationFailureReason =
  | "unsupported"
  | "permission-denied"
  | "position-unavailable"
  | "timeout"
  | "host-failed";

export type GeolocationObservation =
  | { readonly kind: "observed"; readonly position: ObservedGeolocation }
  | { readonly kind: "failed"; readonly reason: GeolocationFailureReason };

export interface GeolocationRequest {
  readonly timeoutMs?: number;
  readonly maximumAgeMs?: number;
  readonly highAccuracy?: boolean;
}

export type GeolocationObserver = (observation: GeolocationObservation) => void;

/** Stops a live subscription. Deterministic and idempotent by contract. */
export type GeolocationUnsubscribe = () => void;

export interface GeolocationCapability {
  /**
   * Reads the best-known permission state. It must not prompt where the
   * platform can answer without prompting.
   */
  readPermission(): Promise<GeolocationPermission>;
  /** Acquires one position. On a promptable host this is what asks. */
  requestPosition(
    request?: GeolocationRequest,
  ): Promise<GeolocationObservation>;
  /** Live updates. The returned function stops the subscription. */
  watchPosition(
    observer: GeolocationObserver,
    request?: GeolocationRequest,
  ): GeolocationUnsubscribe;
}

/**
 * The capability a host without any geolocation provider composes. It answers
 * the same contract instead of forcing feature code to special-case a host.
 */
export const UNSUPPORTED_GEOLOCATION: GeolocationCapability = Object.freeze({
  readPermission: async (): Promise<GeolocationPermission> => "unsupported",
  requestPosition: async (): Promise<GeolocationObservation> => ({
    kind: "failed",
    reason: "unsupported",
  }),
  watchPosition: (observer: GeolocationObserver): GeolocationUnsubscribe => {
    observer({ kind: "failed", reason: "unsupported" });
    return () => undefined;
  },
});

/**
 * A capability that answers one declared point instead of observing the
 * device. A host whose Bond has a manual location composes it so the Bond
 * stands where it was put, while the real device position stays unasked.
 */
export function createDeclaredGeolocation(point: {
  readonly longitude: number;
  readonly latitude: number;
}): GeolocationCapability {
  const observe = (): GeolocationObservation => ({
    kind: "observed",
    position: {
      longitude: point.longitude,
      latitude: point.latitude,
      accuracyMeters: 0,
      observedAt: Date.now(),
      declared: true,
    },
  });
  return Object.freeze({
    readPermission: async (): Promise<GeolocationPermission> => "granted",
    requestPosition: async (): Promise<GeolocationObservation> => observe(),
    // The point does not move, so a watch has nothing to report beyond what a
    // request already answered: it stays silent until it is stopped.
    watchPosition: (): GeolocationUnsubscribe => () => undefined,
  });
}
