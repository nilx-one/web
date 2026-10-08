// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaProximityPolicy } from "@nilx-one/application";
import type { CSSProperties } from "react";

import { useLocalization } from "../../shell/localization";
import "./location-control.css";
import type { LocationControlViewModel } from "./location-control-view-model";

export interface LocationControlProps {
  readonly viewModel: LocationControlViewModel;
  readonly onActivate: () => void;
  readonly proximity?: AvaiaProximityPolicy;
}

/**
 * The compact location affordance over the world. It is also the accessible
 * text alternative for the canvas-only position marker: the marker's meaning
 * is available here as text, not only as a cyan dot.
 */
export function LocationControl({
  viewModel,
  onActivate,
  proximity,
}: LocationControlProps) {
  const { t } = useLocalization();
  const label = t(viewModel.labelKey);
  const hint =
    viewModel.accuracyMeters === undefined
      ? t(viewModel.hintKey)
      : `${t(viewModel.hintKey)} ${viewModel.accuracyMeters} m.`;


  const fraction = proximity === undefined
    ? 0
    : Math.min(1, proximity.distance_m / proximity.red_m);
  const ringStyle = proximity === undefined ? undefined : {
    "--proximity-angle": `${Math.round(fraction * 360)}deg`,
    "--proximity-color": `hsl(${Math.round(190 * (1 - fraction))} 90% 48%)`,
  } as CSSProperties;
  const distanceLabel = proximity === undefined
    ? undefined
    : proximity.distance_m < 1_000
      ? `${proximity.distance_m}m`
      : `${(proximity.distance_m / 1_000).toFixed(1)}km`;

  return (
    <div
      className="location-control"
      data-state={viewModel.state}
      data-proximity={proximity?.level ?? "unknown"}
      style={ringStyle}
    >
      <button
        className="location-control__button"
        type="button"
        aria-label={label}
        aria-describedby="location-control-hint"
        aria-busy={viewModel.busy}
        disabled={viewModel.disabled}
        onClick={onActivate}
      >
        {proximity === undefined ? (
          <span className="location-control__glyph" aria-hidden="true" />
        ) : (
          <>
            <span className="location-control__proximity-ring" aria-hidden="true" />
            <span className="location-control__distance" aria-hidden="true">
              {distanceLabel}
            </span>
          </>
        )}
      </button>
      <span className="visually-hidden" id="location-control-hint">
        {hint}
        {proximity === undefined ? "" : ` Bond ↔ Avaia: ${proximity.distance_m} m; ${proximity.can_reveal ? "reveal available" : "reveal unavailable"}.`}
      </span>
    </div>
  );
}
