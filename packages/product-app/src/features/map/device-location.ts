// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  GeolocationCapability,
  GeolocationFailureReason,
  GeolocationObservation,
  GeolocationPermission,
  ObservedGeolocation,
} from "@nilx-one/host-contract";

/**
 * The device-location lifecycle of one authenticated world.
 *
 * The observation is ephemeral client evidence: it lives here for local
 * presentation and is never persisted, never sent to a backend, and never
 * written into a log or an error report.
 */
export type DeviceLocationState =
  /** The world renderer has not reached `ready`, so nothing has been asked. */
  | { readonly kind: "idle" }
  | { readonly kind: "checking-permission" }
  /**
   * The host can still ask, but this session will not ask again on its own.
   * The location control is the explicit user-gesture path from here.
   */
  | { readonly kind: "permission-required" }
  | { readonly kind: "locating"; readonly position?: ObservedGeolocation }
  | { readonly kind: "active"; readonly position: ObservedGeolocation }
  /** A transient failure. The last valid observation is kept if there was one. */
  | {
      readonly kind: "unavailable";
      readonly reason: Exclude<
        GeolocationFailureReason,
        "unsupported" | "permission-denied"
      >;
      readonly position?: ObservedGeolocation;
    }
  | { readonly kind: "denied" }
  | { readonly kind: "unsupported" };

export interface DeviceLocationController {
  getState(): DeviceLocationState;
  subscribe(listener: (state: DeviceLocationState) => void): () => void;
  /**
   * The persistent world renderer reached `ready`. Starts the once-per-world
   * permission lifecycle; calling it again while the world stays mounted is a
   * no-op, so route changes never duplicate a prompt or a watcher.
   */
  activate(): void;
  /** The explicit user-gesture path: permission retry and manual refresh. */
  requestFromGesture(): void;
  /** World unmount or logout. Stops the watcher and drops the observation. */
  stop(): void;
}

export interface DeviceLocationControllerOptions {
  readonly geolocation: GeolocationCapability;
}

function lastPosition(
  state: DeviceLocationState,
): ObservedGeolocation | undefined {
  switch (state.kind) {
    case "active":
      return state.position;
    case "locating":
    case "unavailable":
      return state.position;
    default:
      return undefined;
  }
}

function failureState(
  reason: GeolocationFailureReason,
  position: ObservedGeolocation | undefined,
  /**
   * An automatic attempt cannot tell a person saying no from a platform that
   * refuses to ask without a gesture, so it never burns the permission: it
   * leaves the explicit control as the way back.
   */
  fromGesture: boolean,
): DeviceLocationState {
  switch (reason) {
    case "unsupported":
      return { kind: "unsupported" };
    case "permission-denied":
      return fromGesture ? { kind: "denied" } : { kind: "permission-required" };
    default:
      return {
        kind: "unavailable",
        reason,
        ...(position === undefined ? {} : { position }),
      };
  }
}

export function createDeviceLocationController(
  options: DeviceLocationControllerOptions,
): DeviceLocationController {
  const { geolocation } = options;
  const listeners = new Set<(state: DeviceLocationState) => void>();
  let state: DeviceLocationState = { kind: "idle" };
  let activated = false;
  /** At most one automatic request per world lifecycle, by contract. */
  let automaticRequestSpent = false;
  let stopWatch: (() => void) | undefined;
  let requestInFlight = false;
  // Async results that outlive a stop() belong to a world that no longer
  // exists, so the generation they were started in is what makes them stale.
  let generation = 0;

  function publish(next: DeviceLocationState): void {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  }

  function startWatch(): void {
    if (stopWatch !== undefined) {
      return;
    }

    const watchGeneration = generation;
    stopWatch = geolocation.watchPosition((observation) => {
      if (watchGeneration !== generation) {
        return;
      }
      applyObservation(observation, false);
    });
  }

  function applyObservation(
    observation: GeolocationObservation,
    fromGesture: boolean,
  ): void {
    if (observation.kind === "observed") {
      publish({ kind: "active", position: observation.position });
      startWatch();
      return;
    }

    if (
      observation.reason === "permission-denied" ||
      observation.reason === "unsupported"
    ) {
      // A revoked or absent capability ends live observation; a transient
      // failure does not.
      stopWatch?.();
      stopWatch = undefined;
    }

    publish(failureState(observation.reason, lastPosition(state), fromGesture));
  }

  function acquire(fromGesture: boolean): void {
    if (requestInFlight) {
      return;
    }

    requestInFlight = true;
    const requestGeneration = generation;
    const position = lastPosition(state);
    publish({
      kind: "locating",
      ...(position === undefined ? {} : { position }),
    });

    void geolocation
      .requestPosition()
      .then((observation) => {
        if (requestGeneration !== generation) {
          return;
        }
        applyObservation(observation, fromGesture);
      })
      .finally(() => {
        if (requestGeneration === generation) {
          requestInFlight = false;
        }
      });
  }

  function beginPermissionLifecycle(): void {
    const lifecycleGeneration = generation;
    publish({ kind: "checking-permission" });

    void geolocation.readPermission().then((permission) => {
      if (lifecycleGeneration !== generation) {
        return;
      }
      applyPermission(permission);
    });
  }

  function applyPermission(permission: GeolocationPermission): void {
    switch (permission) {
      case "unsupported":
        publish({ kind: "unsupported" });
        return;
      case "denied":
        // Never reprompt on a rerender, a route change, or a renderer notice.
        publish({ kind: "denied" });
        return;
      case "granted":
        acquire(false);
        return;
      case "prompt":
        if (automaticRequestSpent) {
          publish({ kind: "permission-required" });
          return;
        }
        automaticRequestSpent = true;
        acquire(false);
    }
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    activate() {
      if (activated) {
        return;
      }
      activated = true;
      beginPermissionLifecycle();
    },

    requestFromGesture() {
      if (state.kind === "unsupported" || state.kind === "locating") {
        return;
      }
      activated = true;
      automaticRequestSpent = true;
      acquire(true);
    },

    stop() {
      generation += 1;
      activated = false;
      automaticRequestSpent = false;
      requestInFlight = false;
      stopWatch?.();
      stopWatch = undefined;
      publish({ kind: "idle" });
    },
  };
}

/** The observation a surface may present, whatever phase the lifecycle is in. */
export function deviceLocationPosition(
  state: DeviceLocationState,
): ObservedGeolocation | undefined {
  return lastPosition(state);
}
