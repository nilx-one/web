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

function declaredObservation(point: {
  readonly longitude: number;
  readonly latitude: number;
}): GeolocationObservation {
  return {
    kind: "observed",
    position: {
      longitude: point.longitude,
      latitude: point.latitude,
      accuracyMeters: 0,
      observedAt: Date.now(),
      declared: true,
    },
  };
}

/**
 * A capability that answers one declared point instead of observing the
 * device. A host whose Bond has a manual location composes it so the Bond
 * stands where it was put, while the real device position stays unasked.
 */
export function createDeclaredGeolocation(point: {
  readonly longitude: number;
  readonly latitude: number;
}): GeolocationCapability {
  const observe = (): GeolocationObservation => declaredObservation(point);
  return Object.freeze({
    readPermission: async (): Promise<GeolocationPermission> => "granted",
    requestPosition: async (): Promise<GeolocationObservation> => observe(),
    // The point does not move, so a watch has nothing to report beyond what a
    // request already answered: it stays silent until it is stopped.
    watchPosition: (): GeolocationUnsubscribe => () => undefined,
  });
}

/**
 * The Bond's one location as the identity service holds it. `live` lets the
 * device observe; `manual` is a declared point that stands the Bond there on
 * every host; `unavailable` is unknown state and never unlocks the device.
 */
export type BondLocationMode =
  | { readonly kind: "live" }
  | {
      readonly kind: "manual";
      readonly position: {
        readonly longitude: number;
        readonly latitude: number;
      };
    }
  | { readonly kind: "unavailable" };

export interface BondLocationGeolocationOptions {
  /** What this host would observe on its own. */
  readonly device: GeolocationCapability;
  /** Reads the Bond's location mode; asked before the device ever is. */
  readonly readLocation: () => Promise<BondLocationMode>;
  /**
   * How often a running watch re-reads the mode, so a point declared on
   * another host reaches this one without a reload.
   */
  readonly recheckMs?: number;
}

const DEFAULT_BOND_LOCATION_RECHECK_MS = 15_000;

function bondLocationFingerprint(mode: BondLocationMode): string {
  return mode.kind === "manual"
    ? `manual:${mode.position.longitude}:${mode.position.latitude}`
    : mode.kind;
}

/**
 * A capability that answers for the Bond rather than for the device alone.
 *
 * A Bond has one location. While it is `manual`, every host stands the Bond
 * at the declared point and the device is never asked, so no host can draw
 * the same Bond a second time at its own device position. Unknown state fails
 * closed: it neither asks the device nor invents a point.
 */
export function createBondLocationGeolocation(
  options: BondLocationGeolocationOptions,
): GeolocationCapability {
  const { device, readLocation } = options;
  const recheckMs = options.recheckMs ?? DEFAULT_BOND_LOCATION_RECHECK_MS;
  // What the last request answered with, so a watch that follows it does not
  // repeat a declared point the caller already holds.
  let answered: string | undefined;

  return Object.freeze({
    readPermission: async (): Promise<GeolocationPermission> => {
      const mode = await readLocation();
      switch (mode.kind) {
        case "manual":
          return "granted";
        case "live":
          return device.readPermission();
        case "unavailable":
          return "prompt";
      }
    },
    requestPosition: async (
      request?: GeolocationRequest,
    ): Promise<GeolocationObservation> => {
      const mode = await readLocation();
      answered = bondLocationFingerprint(mode);
      switch (mode.kind) {
        case "manual":
          return declaredObservation(mode.position);
        case "live":
          return device.requestPosition(request);
        case "unavailable":
          return { kind: "failed", reason: "position-unavailable" };
      }
    },
    watchPosition: (
      observer: GeolocationObserver,
      request?: GeolocationRequest,
    ): GeolocationUnsubscribe => {
      let stopped = false;
      let current: string | undefined;
      let stopDevice: GeolocationUnsubscribe | undefined;

      const apply = (mode: BondLocationMode): void => {
        if (stopped) return;
        // Unknown state never keeps the device observing; a declared point
        // already shown involves no device and stays.
        if (mode.kind === "unavailable") {
          if (stopDevice !== undefined) {
            stopDevice();
            stopDevice = undefined;
            current = mode.kind;
          }
          return;
        }
        const fingerprint = bondLocationFingerprint(mode);
        if (fingerprint === current) return;
        const first = current === undefined;
        current = fingerprint;
        stopDevice?.();
        stopDevice = undefined;
        if (mode.kind === "live") {
          stopDevice = device.watchPosition(observer, request);
          return;
        }
        if (first && fingerprint === answered) return;
        observer(declaredObservation(mode.position));
      };
      const check = (): void => {
        void readLocation().then(apply, () => undefined);
      };

      check();
      const timer = globalThis.setInterval(check, recheckMs);
      return () => {
        if (stopped) return;
        stopped = true;
        globalThis.clearInterval(timer);
        stopDevice?.();
        stopDevice = undefined;
      };
    },
  });
}
