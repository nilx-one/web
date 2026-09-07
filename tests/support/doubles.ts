// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  UNSUPPORTED_GEOLOCATION,
  type GeolocationCapability,
  type GeolocationObservation,
  type GeolocationObserver,
  type GeolocationPermission,
  type ObservedGeolocation,
} from "@nilx-one/host-contract";
import {
  DEFAULT_MAP_CAMERA,
  type MapCamera,
  type MapCameraChange,
  type MapRenderer,
  type MapRendererStatus,
} from "@nilx-one/map-contract";
import { vi } from "vitest";

/**
 * Test doubles for the two ports the authenticated world composes. They are
 * shared so a contract change fails in one place instead of drifting across
 * every surface that mounts the world.
 */

export interface MapRendererDouble extends MapRenderer {
  /** Publishes a camera change as the renderer would after a move. */
  moveCamera(camera: MapCamera, gesture: boolean): void;
}

export function createMapRendererDouble(
  status: MapRendererStatus = { kind: "ready" },
): MapRendererDouble {
  const cameraListeners = new Set<(change: MapCameraChange) => void>();
  let camera: MapCamera = DEFAULT_MAP_CAMERA;

  return {
    mount: vi.fn(),
    unmount: vi.fn(),
    getStatus: vi.fn(() => status),
    subscribe: vi.fn(() => () => undefined),
    getCamera: vi.fn(() => camera),
    // A real renderer settles a programmatic move and publishes the camera it
    // ended on, so the double does too.
    setCamera: vi.fn((next: MapCamera) => {
      camera = next;
      for (const listener of cameraListeners) {
        listener({ camera: next, gesture: false });
      }
    }),
    subscribeCamera: vi.fn((listener: (change: MapCameraChange) => void) => {
      cameraListeners.add(listener);
      return () => cameraListeners.delete(listener);
    }),
    setAppearance: vi.fn(),
    setDimension: vi.fn(),
    setObservedPosition: vi.fn(),
    setObservedPositionLabel: vi.fn(),
    moveCamera(next, gesture) {
      camera = next;
      for (const listener of cameraListeners) {
        listener({ camera: next, gesture });
      }
    },
  };
}

export const UNSUPPORTED_GEOLOCATION_DOUBLE: GeolocationCapability =
  UNSUPPORTED_GEOLOCATION;

export interface GeolocationDouble extends GeolocationCapability {
  /** Publishes a live update to whatever watcher is currently subscribed. */
  publish(observation: GeolocationObservation): void;
  readonly watchers: () => number;
  readonly stopped: () => number;
}

export interface GeolocationDoubleOptions {
  readonly permission?: GeolocationPermission;
  readonly position?: ObservedGeolocation;
  readonly failure?: GeolocationObservation;
}

export function createGeolocationDouble(
  options: GeolocationDoubleOptions = {},
): GeolocationDouble {
  const observers = new Set<GeolocationObserver>();
  let stopped = 0;
  const answer: GeolocationObservation =
    options.failure ??
    (options.position === undefined
      ? { kind: "failed", reason: "position-unavailable" }
      : { kind: "observed", position: options.position });

  return {
    readPermission: vi.fn(async () => options.permission ?? "granted"),
    requestPosition: vi.fn(async () => answer),
    watchPosition: vi.fn((observer: GeolocationObserver) => {
      observers.add(observer);
      return () => {
        stopped += 1;
        observers.delete(observer);
      };
    }),
    publish(observation) {
      for (const observer of [...observers]) {
        observer(observation);
      }
    },
    watchers: () => observers.size,
    stopped: () => stopped,
  };
}

export function observation(
  overrides: Partial<ObservedGeolocation> = {},
): ObservedGeolocation {
  return {
    longitude: 30.5234,
    latitude: 50.4501,
    accuracyMeters: 24,
    observedAt: 1_700_000_000_000,
    ...overrides,
  };
}
