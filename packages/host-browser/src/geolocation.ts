// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationFailureReason,
  GeolocationObservation,
  GeolocationObserver,
  GeolocationPermission,
  GeolocationRequest,
  GeolocationUnsubscribe,
} from "@nilx-one/host-contract";

/**
 * The browser surfaces this capability across two unrelated APIs: Permissions
 * answers what is already decided without asking, and Geolocation acquires. A
 * browser may publish either, both, or a partial version of either.
 */
export interface BrowserGeolocationEnvironment {
  readonly geolocation?: Geolocation;
  readonly permissions?: Permissions;
  /** Geolocation is gated on a secure context in every supported browser. */
  readonly isSecureContext?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAXIMUM_AGE_MS = 30_000;

// Numeric codes rather than the constants: the error object a browser hands a
// callback is not guaranteed to carry the class constants, and a raw provider
// error must never travel further than this adapter.
const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function failureReason(code: unknown): GeolocationFailureReason {
  switch (code) {
    case PERMISSION_DENIED:
      return "permission-denied";
    case POSITION_UNAVAILABLE:
      return "position-unavailable";
    case TIMEOUT:
      return "timeout";
    default:
      return "host-failed";
  }
}

function observed(position: GeolocationPosition): GeolocationObservation {
  return {
    kind: "observed",
    position: {
      longitude: position.coords.longitude,
      latitude: position.coords.latitude,
      accuracyMeters: position.coords.accuracy,
      observedAt: position.timestamp,
    },
  };
}

function positionOptions(request: GeolocationRequest): PositionOptions {
  return {
    enableHighAccuracy: request.highAccuracy ?? false,
    timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maximumAge: request.maximumAgeMs ?? DEFAULT_MAXIMUM_AGE_MS,
  };
}

function permissionState(state: string): GeolocationPermission {
  switch (state) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    default:
      return "prompt";
  }
}

class BrowserGeolocation implements GeolocationCapability {
  public constructor(
    private readonly environment: BrowserGeolocationEnvironment,
  ) {}

  private provider(): Geolocation | undefined {
    // An insecure context and a Permissions Policy that withholds the feature
    // both leave the API present and permanently unusable; the secure-context
    // half is the one a client can read before it asks.
    if (this.environment.isSecureContext === false) {
      return undefined;
    }
    return this.environment.geolocation;
  }

  public async readPermission(): Promise<GeolocationPermission> {
    if (this.provider() === undefined) {
      return "unsupported";
    }

    const permissions = this.environment.permissions;
    if (permissions?.query === undefined) {
      return "prompt";
    }

    try {
      // Browsers without the geolocation descriptor reject here. That is not a
      // denial: it only means the state cannot be read without asking.
      const status = await permissions.query({
        name: "geolocation" as PermissionName,
      });
      return permissionState(status.state);
    } catch {
      return "prompt";
    }
  }

  public async requestPosition(
    request: GeolocationRequest = {},
  ): Promise<GeolocationObservation> {
    const provider = this.provider();
    if (provider === undefined) {
      return { kind: "failed", reason: "unsupported" };
    }

    return new Promise<GeolocationObservation>((resolve) => {
      let settled = false;
      const settle = (observation: GeolocationObservation): void => {
        if (settled) return;
        settled = true;
        resolve(observation);
      };

      try {
        provider.getCurrentPosition(
          (position) => settle(observed(position)),
          (error: { readonly code?: number }) =>
            settle({ kind: "failed", reason: failureReason(error?.code) }),
          positionOptions(request),
        );
      } catch {
        // A Permissions Policy violation throws synchronously in some engines.
        settle({ kind: "failed", reason: "permission-denied" });
      }
    });
  }

  public watchPosition(
    observer: GeolocationObserver,
    request: GeolocationRequest = {},
  ): GeolocationUnsubscribe {
    const provider = this.provider();
    if (provider === undefined) {
      observer({ kind: "failed", reason: "unsupported" });
      return () => undefined;
    }

    let watchId: number | undefined;
    let stopped = false;

    try {
      watchId = provider.watchPosition(
        (position) => {
          if (!stopped) observer(observed(position));
        },
        (error: { readonly code?: number }) => {
          if (!stopped) {
            observer({ kind: "failed", reason: failureReason(error?.code) });
          }
        },
        positionOptions(request),
      );
    } catch {
      observer({ kind: "failed", reason: "permission-denied" });
      return () => undefined;
    }

    return () => {
      if (stopped) return;
      stopped = true;
      if (watchId !== undefined) {
        provider.clearWatch(watchId);
      }
    };
  }
}

export function createBrowserGeolocation(
  environment: BrowserGeolocationEnvironment = {
    ...(navigator.geolocation === undefined
      ? {}
      : { geolocation: navigator.geolocation }),
    ...(navigator.permissions === undefined
      ? {}
      : { permissions: navigator.permissions }),
    isSecureContext: window.isSecureContext,
  },
): GeolocationCapability {
  return new BrowserGeolocation(environment);
}
