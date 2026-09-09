// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVAIA_MODEL_UNAVAILABLE,
  type AvaiaSetupViewState,
} from "./avaia-setup-view-model";
import "./avaia-setup.css";

export interface AvaiaSetupViewProps {
  readonly state: AvaiaSetupViewState;
  onDraftChange(value: string): void;
  onSubmit(): void;
}

/**
 * The compact surface an owner configures their Avaia from.
 *
 * It carries the address and nothing it cannot honestly offer. The 3D model is
 * present because a person deciding about an Avaia should see that a body is
 * part of what an Avaia is — and disabled because this contract publishes no
 * model capability to choose from. Nothing is invented to fill it.
 */
export function AvaiaSetupView({
  state,
  onDraftChange,
  onSubmit,
}: AvaiaSetupViewProps) {
  return (
    <div className="avaia-setup" data-configuration={state.configuration}>
      <div className="avaia-setup__summary">
        <span className="bond-dock__glyph" aria-hidden="true">
          AI
        </span>
        <span>
          <strong>{state.address}</strong>
          <small>{state.configurationLabel}</small>
        </span>
      </div>

      <form
        className="profile-edit__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (state.canSave) onSubmit();
        }}
      >
        <label className="avaia-setup__label" htmlFor="avaia-pub-dress">
          pub_dress
        </label>
        <div className="profile-edit__address">
          <input
            id="avaia-pub-dress"
            name="avaia-pub-dress"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={state.draft}
            disabled={!state.editable || state.busy}
            aria-describedby="avaia-pub-dress-note"
            aria-invalid={state.error !== undefined}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
          <button
            className="profile-edit__save"
            type="submit"
            disabled={!state.canSave}
          >
            {state.busy ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="profile-edit__note" id="avaia-pub-dress-note">
          {state.note}
        </p>

        <label className="avaia-setup__label" htmlFor="avaia-model">
          3D model
        </label>
        <div className="profile-edit__address avaia-setup__readonly">
          <input
            id="avaia-model"
            name="avaia-model"
            type="text"
            value={AVAIA_MODEL_UNAVAILABLE}
            readOnly
            disabled
          />
        </div>
        <p className="profile-edit__note">
          A body for this Avaia is not something this contract publishes yet, so
          there is nothing here to choose.
        </p>

        {state.status === undefined ? null : (
          <p className="profile-edit__note" role="status">
            {state.status}
          </p>
        )}
        {state.error === undefined ? null : (
          <p className="profile-edit__error" role="alert">
            {state.error}
          </p>
        )}
      </form>
    </div>
  );
}
