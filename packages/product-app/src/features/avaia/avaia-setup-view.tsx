// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaSetupViewState } from "./avaia-setup-view-model";
import "./avaia-setup.css";

export interface AvaiaSetupViewProps {
  readonly state: AvaiaSetupViewState;
  /** Receives only the mutable portion between discriminator and `ai`. */
  onDraftChange(value: string): void;
  onSubmit(): void;
}

/**
 * The compact surface an owner configures their Avaia from.
 *
 * It carries the address and nothing it cannot honestly offer. A disabled "3D
 * model: Not available yet" field used to sit here for the same reason the
 * Dock's own `AvatarModelField` now sits right below this surface — but that
 * field is real, so the dead one only duplicated it. Commented out rather
 * than deleted, in case this surface ever needs to say something about a
 * model capability of its own again.
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
        <div className="profile-edit__address avaia-setup__address">
          <span className="profile-edit__discriminator" aria-hidden="true">
            {state.prefix}
          </span>
          <input
            id="avaia-pub-dress"
            name="avaia-pub-dress"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={state.slugStem}
            disabled={!state.editable || state.busy}
            aria-describedby="avaia-pub-dress-note"
            aria-invalid={state.error !== undefined}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
          />
          <span className="profile-edit__affix" aria-hidden="true">
            {state.suffix}
          </span>
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

        {/* Hidden for now: duplicated the real AvatarModelField rendered
            right after this surface. See avaia-setup-view-model.ts for
            AVAIA_MODEL_UNAVAILABLE, kept for whenever this comes back.
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
        */}

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
