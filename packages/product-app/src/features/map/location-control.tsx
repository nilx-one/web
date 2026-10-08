// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaProximityPolicy } from "@nilx-one/application";
import type { CSSProperties } from "react";

import { useLocalization } from "../../shell/localization";
import "./location-control.css";
import type { LocationControlViewModel } from "./location-control-view-model";

/**
 * What the control says about Avaia: Core's policy for the Bond–Avaia
 * distance, `"unknown"` when Core is there but cannot say (no position, no
 * fresh answer), and absent when this host has no proximity at all.
 */
export type LocationControlProximity = AvaiaProximityPolicy | "unknown";

export interface LocationControlProps {
  readonly viewModel: LocationControlViewModel;
  readonly onActivate: () => void;
  readonly proximity?: LocationControlProximity | undefined;
}

/**
 * The compact location affordance over the world. It is also the accessible
 * text alternative for the canvas-only position marker: the marker's meaning
 * is available here as text, not only as a cyan dot.
 *
 * It keeps its one job — a tap recentres on this
 * device or asks for it — and, when a proximity is given, wears the Bond–Avaia
 * distance on its face: a cyan circle that bleeds toward red as Avaia gets
 * further away. The number, not the colour, carries the meaning, and the
 * spoken hint says whether fog work is on hold.
 */
export function LocationControl({
  viewModel,
  onActivate,
  proximity,
}: LocationControlProps) {
  const { t } = useLocalization();
  const label = t(viewModel.labelKey);
  const base =
    viewModel.accuracyMeters === undefined
      ? t(viewModel.hintKey)
      : `${t(viewModel.hintKey)} ${viewModel.accuracyMeters} m.`;

  const policy = proximity === "unknown" ? undefined : proximity;
  const distanceLabel =
    policy === undefined
      ? undefined
      : policy.distance_m < 1_000
        ? t("proximity.distance.m").replace(
            "{value}",
            String(policy.distance_m),
          )
        : t("proximity.distance.km").replace(
            "{value}",
            (policy.distance_m / 1_000).toFixed(1),
          );
  const proximityHint =
    proximity === undefined
      ? ""
      : proximity === "unknown"
        ? t("proximity.hint.unknown")
        : t(
            proximity.can_reveal
              ? "proximity.hint.open"
              : "proximity.hint.blocked",
          ).replace("{distance}", distanceLabel ?? "");
  const hint = proximityHint === "" ? base : `${base} ${proximityHint}`;

  const fraction =
    policy === undefined ? 0 : Math.min(1, policy.distance_m / policy.red_m);
  const ringStyle =
    proximity === undefined
      ? undefined
      : ({
          "--proximity-angle": `${Math.round(fraction * 360)}deg`,
          "--proximity-color":
            policy === undefined
              ? "currentColor"
              : `hsl(${Math.round(190 * (1 - fraction))} 90% 48%)`,
        } as CSSProperties);

  return (
    <div
      className="location-control"
      data-state={viewModel.state}
      data-proximity={
        proximity === undefined ? "none" : (policy?.level ?? "unknown")
      }
      data-reveal={
        policy === undefined ? "unknown" : policy.can_reveal ? "open" : "held"
      }
      style={ringStyle}
    >
      <button
        className="location-control__button"
        type="button"
        aria-label={label}
        aria-describedby="location-control-hint"
        disabled={viewModel.disabled}
        onClick={onActivate}
      >
        {proximity === undefined ? (
          <span className="location-control__glyph" aria-hidden="true" />
        ) : (
          <>
            <span
              className="location-control__proximity-ring"
              aria-hidden="true"
            />
            <span className="location-control__distance" aria-hidden="true">
              {distanceLabel ?? "?"}
            </span>
          </>
        )}
      </button>
      <span className="visually-hidden" id="location-control-hint">
        {hint}
      </span>
    </div>
  );
}
