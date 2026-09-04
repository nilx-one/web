// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

export interface WorldPosition {
  readonly longitude: number;
  readonly latitude: number;
}

export type MovementState =
  | { readonly kind: "idle"; readonly position: WorldPosition }
  | {
      readonly kind: "moving";
      readonly position: WorldPosition;
      readonly target: WorldPosition;
    }
  | { readonly kind: "arrived"; readonly position: WorldPosition };

export interface AvaiaMovementController {
  getState(): MovementState;
  navigateTo(target: WorldPosition): void;
  stop(): void;
  tick(deltaSeconds: number): MovementState;
}

export interface AvaiaMovementControllerOptions {
  readonly initialPosition: WorldPosition;
  readonly speedMetersPerSecond?: number;
  readonly arrivalRadiusMeters?: number;
}

const EARTH_RADIUS_METERS = 6_371_008.8;
const DEFAULT_SPEED_METERS_PER_SECOND = 1.4;
const DEFAULT_ARRIVAL_RADIUS_METERS = 0.25;

function assertFinitePosition(position: WorldPosition): void {
  if (
    !Number.isFinite(position.longitude) ||
    !Number.isFinite(position.latitude) ||
    position.longitude < -180 ||
    position.longitude > 180 ||
    position.latitude < -90 ||
    position.latitude > 90
  ) {
    throw new RangeError("invalid-world-position");
  }
}

function distanceMeters(from: WorldPosition, to: WorldPosition): number {
  const toRadians = Math.PI / 180;
  const lat1 = from.latitude * toRadians;
  const lat2 = to.latitude * toRadians;
  const deltaLat = (to.latitude - from.latitude) * toRadians;
  const deltaLon = (to.longitude - from.longitude) * toRadians;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function interpolate(
  from: WorldPosition,
  to: WorldPosition,
  fraction: number,
): WorldPosition {
  return {
    longitude: from.longitude + (to.longitude - from.longitude) * fraction,
    latitude: from.latitude + (to.latitude - from.latitude) * fraction,
  };
}

export function createAvaiaMovementController(
  options: AvaiaMovementControllerOptions,
): AvaiaMovementController {
  assertFinitePosition(options.initialPosition);
  const speed = options.speedMetersPerSecond ?? DEFAULT_SPEED_METERS_PER_SECOND;
  const arrivalRadius =
    options.arrivalRadiusMeters ?? DEFAULT_ARRIVAL_RADIUS_METERS;
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new RangeError("invalid-movement-speed");
  }
  if (!Number.isFinite(arrivalRadius) || arrivalRadius < 0) {
    throw new RangeError("invalid-arrival-radius");
  }

  let state: MovementState = {
    kind: "idle",
    position: options.initialPosition,
  };

  return {
    getState() {
      return state;
    },

    navigateTo(target) {
      assertFinitePosition(target);
      state = {
        kind: "moving",
        position: state.position,
        target,
      };
    },

    stop() {
      state = { kind: "idle", position: state.position };
    },

    tick(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        throw new RangeError("invalid-delta-seconds");
      }
      if (state.kind !== "moving" || deltaSeconds === 0) {
        return state;
      }

      const remaining = distanceMeters(state.position, state.target);
      const step = speed * deltaSeconds;
      if (remaining <= Math.max(arrivalRadius, step)) {
        state = { kind: "arrived", position: state.target };
        return state;
      }

      state = {
        kind: "moving",
        position: interpolate(state.position, state.target, step / remaining),
        target: state.target,
      };
      return state;
    },
  };
}
