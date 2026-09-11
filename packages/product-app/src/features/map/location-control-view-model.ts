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

export type LocationControlTranslationKey =
  | "location.unsupported.label"
  | "location.unsupported.hint"
  | "location.denied.label"
  | "location.denied.hint"
  | "location.enable.label"
  | "location.enable.hint"
  | "location.locating.label"
  | "location.locating.hint"
  | "location.unavailable.retryLabel"
  | "location.unavailable.recenterLabel"
  | "location.unavailable.timeoutHint"
  | "location.unavailable.positionHint"
  | "location.centered.label"
  | "location.recenter.label"
  | "location.accuracy.approx";

export interface LocationControlViewModel {
  readonly state: LocationControlState;
  /** Presentation resolves these typed keys through the active locale. */
  readonly labelKey: LocationControlTranslationKey;
  readonly hintKey: LocationControlTranslationKey;
  readonly accuracyMeters?: number;
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
        labelKey: "location.unsupported.label",
        hintKey: "location.unsupported.hint",
        disabled: true,
        busy: false,
        intent: "none",
      };
    case "denied":
      return {
        state: "denied",
        labelKey: "location.denied.label",
        hintKey: "location.denied.hint",
        disabled: false,
        busy: false,
        intent: "request",
      };
    case "idle":
    case "checking-permission":
    case "permission-required":
      return {
        state: "permission-required",
        labelKey: "location.enable.label",
        hintKey: "location.enable.hint",
        disabled: false,
        busy: location.kind === "checking-permission",
        intent: "request",
      };
    case "locating":
      return {
        state: "locating",
        labelKey: "location.locating.label",
        hintKey: "location.locating.hint",
        disabled: true,
        busy: true,
        intent: "none",
      };
    case "unavailable":
      return {
        state: "unavailable",
        labelKey:
          location.position === undefined
            ? "location.unavailable.retryLabel"
            : "location.unavailable.recenterLabel",
        hintKey:
          location.reason === "timeout"
            ? "location.unavailable.timeoutHint"
            : "location.unavailable.positionHint",
        disabled: false,
        busy: false,
        intent: location.position === undefined ? "request" : "recenter",
      };
    case "active":
      return cameraCentered
        ? {
            state: "centered",
            labelKey: "location.centered.label",
            hintKey: "location.accuracy.approx",
            accuracyMeters: Math.round(location.position.accuracyMeters),
            disabled: false,
            busy: false,
            intent: "recenter",
          }
        : {
            state: "displaced",
            labelKey: "location.recenter.label",
            hintKey: "location.accuracy.approx",
            accuracyMeters: Math.round(location.position.accuracyMeters),
            disabled: false,
            busy: false,
            intent: "recenter",
          };
  }
}
