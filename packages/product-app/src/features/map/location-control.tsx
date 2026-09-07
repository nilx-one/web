// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import "./location-control.css";
import type { LocationControlViewModel } from "./location-control-view-model";

export interface LocationControlProps {
  readonly viewModel: LocationControlViewModel;
  readonly onActivate: () => void;
}

/**
 * The compact location affordance over the world. It is also the accessible
 * text alternative for the canvas-only position marker: the marker's meaning
 * is available here as text, not only as a cyan dot.
 */
export function LocationControl({
  viewModel,
  onActivate,
}: LocationControlProps) {
  return (
    <div className="location-control" data-state={viewModel.state}>
      <button
        className="location-control__button"
        type="button"
        aria-label={viewModel.label}
        aria-describedby="location-control-hint"
        aria-busy={viewModel.busy}
        disabled={viewModel.disabled}
        onClick={onActivate}
      >
        <span className="location-control__glyph" aria-hidden="true" />
      </button>
      <span className="visually-hidden" id="location-control-hint">
        {viewModel.hint}
      </span>
    </div>
  );
}
