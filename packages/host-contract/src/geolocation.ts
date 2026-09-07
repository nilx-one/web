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
