// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaConfigurationState,
  AvaiaProfileUpdateResult,
} from "@nilx-one/application";

import type { AvaiaProfileLoadState } from "./use-avaia-profile";
import "./avaia-setup-view.css";

function saveError(result: AvaiaProfileUpdateResult | undefined): string | undefined {
  if (result === undefined || result.kind === "updated") return undefined;
  if (result.kind === "service-unavailable") {
    return "Avaia profile is temporarily unavailable.";
  }
  switch (result.reason) {
    case "authentication-required":
      return "Sign in again before saving this Avaia.";
    case "invalid-address":
      return "That is not a canonical Avaia public address.";
    case "owner-discriminator-mismatch":
      return "The Avaia address must keep this Bond’s discriminator.";
    case "unavailable":
      return "That Avaia address belongs to another identity.";
    case "rate-limited":
      return "Too many Avaia changes. Try again later.";
  }
}

function loadMessage(load: AvaiaProfileLoadState): string | undefined {
  switch (load.kind) {
    case "loading":
      return "Loading Avaia profile…";
    case "authentication-required":
      return "Sign in again to edit this Avaia.";
    case "service-unavailable":
      return "Avaia profile is temporarily unavailable.";
    case "unsupported":
    case "available":
      return undefined;
  }
}

export interface AvaiaSetupViewProps {
  readonly address: string;
  readonly configurationState?: AvaiaConfigurationState;
  readonly load: AvaiaProfileLoadState;
  readonly draft: string;
  readonly saving: boolean;
  readonly saveResult?: AvaiaProfileUpdateResult;
  onDraftChange(value: string): void;
  onSave(): void;
}

export function AvaiaSetupView({
  address,
  configurationState,
  load,
  draft,
  saving,
  saveResult,
  onDraftChange,
  onSave,
}: AvaiaSetupViewProps) {
  const unavailable = load.kind !== "available";
  const message = loadMessage(load);
  const error = saveError(saveResult);

  return (
    <div className="avaia-setup" data-configuration={configurationState}>
      <div className="avaia-setup__summary">
        <span className="avaia-setup__glyph" aria-hidden="true">
          AI
        </span>
        <span>
          <strong>{address}</strong>
          <small>
            {configurationState === "unconfigured"
              ? "unconfigured"
              : configurationState === "configured"
                ? "configured"
                : "profile unavailable"}
          </small>
        </span>
      </div>

      {message === undefined ? null : (
        <p className="profile-edit__note" role="status">
          {message}
        </p>
      )}

      <form
        className="avaia-setup__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!unavailable && !saving && draft.trim().length > 0) onSave();
        }}
      >
        <label className="interface-settings__eyebrow" htmlFor="avaia-address">
          Avaia public address
        </label>
        <input
          className="avaia-setup__address"
          id="avaia-address"
          name="avaia-address"
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft}
          disabled={unavailable || saving}
          aria-describedby="avaia-address-note"
          aria-invalid={error !== undefined}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <p className="profile-edit__note" id="avaia-address-note">
          0x1 validates the complete address and owner discriminator on save.
        </p>

        <fieldset className="avaia-setup__model" disabled>
          <legend>3D model</legend>
          <label htmlFor="avaia-model">Model</label>
          <input
            id="avaia-model"
            name="avaia-model"
            value="Not available yet"
            readOnly
          />
          <p className="profile-edit__note">
            Model selection is not published by this identity contract yet.
          </p>
        </fieldset>

        {error === undefined ? null : (
          <p className="profile-edit__error" role="alert">
            {error}
          </p>
        )}

        <button
          className="profile-edit__save avaia-setup__save"
          type="submit"
          disabled={unavailable || saving || draft.trim().length === 0}
        >
          {saving ? "Saving…" : "Save Avaia"}
        </button>
      </form>
    </div>
  );
}
