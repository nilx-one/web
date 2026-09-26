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
  type MapFogCell,
  type MapFogField,
  type MapGroundTap,
  type MapLandmark,
  type MapPointSelection,
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
  /** Publishes a person reaching for a body the world is drawing. */
  activateBody(id: string): void;
  /** Publishes a person tapping the ground where no body is drawn. */
  tapGround(tap: MapGroundTap): void;
  /**
   * Sets what the basemap answers for landmarks near any point, and — as a
   * real renderer does once tiles settle — says that answer may have changed.
   */
  setLandmarks(landmarks: readonly MapLandmark[]): void;
}

export function createMapRendererDouble(
  status: MapRendererStatus = { kind: "ready" },
): MapRendererDouble {
  const cameraListeners = new Set<(change: MapCameraChange) => void>();
  const bodyListeners = new Set<(activation: { id: string }) => void>();
  const groundListeners = new Set<(tap: MapGroundTap) => void>();
  const landmarkListeners = new Set<() => void>();
  let landmarks: readonly MapLandmark[] = [];
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
    subscribeBodyActivation: vi.fn(
      (listener: (activation: { id: string }) => void) => {
        bodyListeners.add(listener);
        return () => bodyListeners.delete(listener);
      },
    ),
    subscribeGroundTap: vi.fn((listener: (tap: MapGroundTap) => void) => {
      groundListeners.add(listener);
      return () => groundListeners.delete(listener);
    }),
    landmarksNear: vi.fn(() => landmarks),
    subscribeLandmarksChanged: vi.fn((listener: () => void) => {
      landmarkListeners.add(listener);
      return () => landmarkListeners.delete(listener);
    }),
    // The avatar surface a real renderer publishes, so a test can see which
    // body the application asked the world to draw.
    avatars: {
      upsert: vi.fn(),
      remove: vi.fn(),
      setCamera: vi.fn(),
    },
    setAppearance: vi.fn(),
    setDimension: vi.fn(),
    setObservedPosition: vi.fn(),
    setObservedPositionLabel: vi.fn(),
    setPinnedLandmarks: vi.fn(),
    moveCamera(next, gesture) {
      camera = next;
      for (const listener of cameraListeners) {
        listener({ camera: next, gesture });
      }
    },
    activateBody(id) {
      for (const listener of [...bodyListeners]) listener({ id });
    },
    tapGround(tap) {
      for (const listener of [...groundListeners]) listener(tap);
    },
    setLandmarks(next) {
      landmarks = next;
      for (const listener of [...landmarkListeners]) listener();
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

/**
 * A fog cut into a strip of cells `step` degrees of longitude wide. Crude,
 * but it has the one property the application relies on: a point always
 * falls in exactly one cell, and neighbours are one step apart.
 */
/**
 * A fog field double that keeps one reveal set per bound owner, the way
 * `map-shade`'s real field does: revealing is never answered from, or
 * written to, any owner but the one last bound, and unbound reveals live in
 * memory only. `revealed` always reads the currently bound owner's set (or
 * an owner-less scratch set before `bindOwner` is ever called), so a test
 * that never cares about ownership can keep reading it exactly as before.
 */
export function createFogFieldDouble(
  step = 0.001,
): MapFogField & { readonly revealed: Set<string> } {
  const perOwner = new Map<string, Set<string>>();
  const unbound = new Set<string>();
  let owner: string | undefined;
  const listeners = new Set<() => void>();
  const index = (point: MapPointSelection) =>
    Math.round(point.longitude / step);
  const cell = (at: number): MapFogCell => ({
    id: `strip:${at}`,
    center: { longitude: at * step, latitude: 50.4501 },
    boundary: [
      [(at - 0.5) * step, 50.449],
      [(at + 0.5) * step, 50.449],
      [at * step, 50.451],
    ],
  });
  const currentRevealed = (): Set<string> => {
    if (owner === undefined) return unbound;
    let set = perOwner.get(owner);
    if (set === undefined) {
      set = new Set<string>();
      perOwner.set(owner, set);
    }
    return set;
  };
  return {
    get revealed() {
      return currentRevealed();
    },
    isActive: () => true,
    cellAt: (point) => cell(index(point)),
    isRevealed: (id) => currentRevealed().has(id),
    frontier(point, rings) {
      const revealed = currentRevealed();
      const origin = index(point);
      const found: MapFogCell[] = [];
      for (let ring = 0; ring <= rings; ring += 1) {
        for (const at of ring === 0
          ? [origin]
          : [origin - ring, origin + ring]) {
          if (!revealed.has(`strip:${at}`)) found.push(cell(at));
        }
      }
      return found;
    },
    reveal(id) {
      const revealed = currentRevealed();
      if (revealed.has(id)) return;
      revealed.add(id);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bindOwner(next) {
      if (owner === next) return;
      owner = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
