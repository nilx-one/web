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

export type LocationControlTranslate = (
  key: LocationControlTranslationKey,
) => string;

export function createLocationControlViewModel(
  location: DeviceLocationState,
  cameraCentered: boolean,
  t: LocationControlTranslate,
): LocationControlViewModel {
  switch (location.kind) {
    case "unsupported":
      return {
        state: "unsupported",
        label: t("location.unsupported.label"),
        hint: t("location.unsupported.hint"),
        disabled: true,
        busy: false,
        intent: "none",
      };
    case "denied":
      return {
        state: "denied",
        label: t("location.denied.label"),
        hint: t("location.denied.hint"),
        disabled: false,
        busy: false,
        intent: "request",
      };
    case "idle":
    case "checking-permission":
    case "permission-required":
      return {
        state: "permission-required",
        label: t("location.enable.label"),
        hint: t("location.enable.hint"),
        disabled: false,
        busy: location.kind === "checking-permission",
        intent: "request",
      };
    case "locating":
      return {
        state: "locating",
        label: t("location.locating.label"),
        hint: t("location.locating.hint"),
        disabled: true,
        busy: true,
        intent: "none",
      };
    case "unavailable":
      return {
        state: "unavailable",
        label:
          location.position === undefined
            ? t("location.unavailable.retryLabel")
            : t("location.unavailable.recenterLabel"),
        hint:
          location.reason === "timeout"
            ? t("location.unavailable.timeoutHint")
            : t("location.unavailable.positionHint"),
        disabled: false,
        busy: false,
        intent: location.position === undefined ? "request" : "recenter",
      };
    case "active": {
      const hint = `${t("location.accuracy.approx")} ${Math.round(location.position.accuracyMeters)} m.`;
      return cameraCentered
        ? {
            state: "centered",
            label: t("location.centered.label"),
            hint,
            disabled: false,
            busy: false,
            intent: "recenter",
          }
        : {
            state: "displaced",
            label: t("location.recenter.label"),
            hint,
            disabled: false,
            busy: false,
            intent: "recenter",
          };
    }
  }
}
