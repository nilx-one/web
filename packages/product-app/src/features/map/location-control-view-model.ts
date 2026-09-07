// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { DeviceLocationState } from "./device-location";

/**
 * What the location control communicates. The control carries the ordinary
 * denied and unsupported conditions itself so those never become repeated
 * toasts over the world.
 */
export type LocationControlState =
  | "unsupported"
  | "permission-required"
  | "denied"
  | "locating"
  | "unavailable"
  | "displaced"
  | "centered";

export interface LocationControlViewModel {
  readonly state: LocationControlState;
  /** Accessible name. State is never conveyed by the accent colour alone. */
  readonly label: string;
  readonly hint: string;
  readonly disabled: boolean;
  readonly busy: boolean;
  /** What tapping the control does now: ask the host, or move the camera. */
  readonly intent: "request" | "recenter" | "none";
}

export function createLocationControlViewModel(
  location: DeviceLocationState,
  cameraCentered: boolean,
): LocationControlViewModel {
  switch (location.kind) {
    case "unsupported":
      return {
        state: "unsupported",
        label: "Location unavailable on this host",
        hint: "This host provides no device location.",
        disabled: true,
        busy: false,
        intent: "none",
      };
    case "denied":
      return {
        state: "denied",
        label: "Location permission denied",
        hint: "Location is blocked for this site in your browser settings.",
        disabled: false,
        busy: false,
        intent: "request",
      };
    case "idle":
    case "checking-permission":
    case "permission-required":
      return {
        state: "permission-required",
        label: "Enable location",
        hint: "Show this device on the map.",
        disabled: false,
        busy: location.kind === "checking-permission",
        intent: "request",
      };
    case "locating":
      return {
        state: "locating",
        label: "Locating this device",
        hint: "Waiting for a position from this device.",
        disabled: true,
        busy: true,
        intent: "none",
      };
    case "unavailable":
      return {
        state: "unavailable",
        label:
          location.position === undefined
            ? "Location unavailable, try again"
            : "Recenter on the last known position",
        hint:
          location.reason === "timeout"
            ? "This device did not answer in time."
            : "This device could not resolve a position.",
        disabled: false,
        busy: false,
        intent: location.position === undefined ? "request" : "recenter",
      };
    case "active":
      return cameraCentered
        ? {
            state: "centered",
            label: "Map centred on this device",
            hint: `Accuracy about ${Math.round(location.position.accuracyMeters)} m.`,
            disabled: false,
            busy: false,
            intent: "recenter",
          }
        : {
            state: "displaced",
            label: "Recenter on this device",
            hint: `Accuracy about ${Math.round(location.position.accuracyMeters)} m.`,
            disabled: false,
            busy: false,
            intent: "recenter",
          };
  }
}
