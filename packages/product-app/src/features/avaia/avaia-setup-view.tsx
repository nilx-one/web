// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvaiaSetupViewState } from "./avaia-setup-view-model";
import "./avaia-setup.css";

export interface AvaiaSetupViewProps {
  readonly state: AvaiaSetupViewState;
  onDraftChange(value: string): void;
  onSubmit(): void;
}

/**
 * What an owner decides about the Avaia they own.
 *
 * The three sections are three different kinds of fact and are kept apart on
 * purpose: the address the service stores, the runtime this device may or may
 * not have, and the body the world draws. Only the first is written here, and
 * the other two never gate it — an Avaia is configured from wherever its owner
 * happens to be standing.
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

      <section className="avaia-setup__section">
        <h3 className="interface-settings__eyebrow">Identity</h3>
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
          {state.saved === undefined ? null : (
            <p className="profile-edit__saved">
              Saved. This Avaia is {state.saved}.
            </p>
          )}
        </form>
      </section>

      {/* A runtime is a fact about this device. It is stated, never chosen, and
          never allowed to stand in for who the Avaia is. */}
      <section className="avaia-setup__section">
        <h3 className="interface-settings__eyebrow">AI model</h3>
        <label className="avaia-setup__label" htmlFor="avaia-ai-model">
          AI model
        </label>
        <div className="profile-edit__address avaia-setup__readonly">
          <input
            id="avaia-ai-model"
            name="avaia-ai-model"
            type="text"
            value={state.aiModel.value}
            readOnly
            disabled
          />
        </div>
        <p className="profile-edit__note">{state.aiModel.note}</p>
      </section>

      {/* How the Avaia looks is not what thinks for it. The world already draws
          a body; this names it and stops there. */}
      <section className="avaia-setup__section">
        <h3 className="interface-settings__eyebrow">Render model</h3>
        <div className="avaia-setup__render">
          {state.renderModel.study === undefined ? null : (
            <img
              className="avaia-setup__study"
              src={state.renderModel.study.previewUrl}
              alt=""
              aria-hidden="true"
            />
          )}
          <p className="avaia-setup__render-value">{state.renderModel.value}</p>
        </div>
        <p className="profile-edit__note">{state.renderModel.note}</p>
      </section>
    </div>
  );
}
