// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { GeolocationCapability } from "@nilx-one/host-contract";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  createDeviceLocationController,
  type DeviceLocationState,
} from "./device-location";

export interface DeviceLocation {
  readonly state: DeviceLocationState;
  readonly activate: () => void;
  readonly requestFromGesture: () => void;
}

/**
 * Binds the device-location lifecycle to the owner of the authenticated world.
 * Unmounting that owner — logout, or the world going away — stops the watcher
 * and drops the observation; a route change over a mounted world does not.
 */
export function useDeviceLocation(
  geolocation: GeolocationCapability,
): DeviceLocation {
  const controller = useMemo(
    () => createDeviceLocationController({ geolocation }),
    [geolocation],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => () => controller.stop(), [controller]);

  return useMemo(
    () => ({
      state,
      activate: controller.activate,
      requestFromGesture: controller.requestFromGesture,
    }),
    [controller, state],
  );
}
