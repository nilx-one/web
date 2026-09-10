// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AvatarPreviewCanvas } from "./avatar-preview-canvas";
import type { AvatarFieldViewState } from "./avatar-editor-view-model";

export interface AvatarModelFieldProps {
  readonly state: AvatarFieldViewState;
  readonly onOpen: () => void;
}

/**
 * The body a subject is represented by, wherever that subject is configured.
 *
 * The whole field opens the editor: a person reaching for the little figure is
 * reaching for the body, so the picture is not a separate target from the name
 * beside it. What it shows is what is saved — never a draft, and never another
 * study's still standing in for this one.
 */
export function AvatarModelField({
  state,
  onOpen,
}: AvatarModelFieldProps): React.ReactElement {
  return (
    <button
      className="avatar-field"
      type="button"
      onClick={onOpen}
      aria-label={state.openLabel}
    >
      <span className="avatar-field__figure">
        {state.scene === undefined ? (
          // No study chosen is not a body standing in a default outfit: the
          // world draws nothing, and neither does this.
          <span className="avatar-field__empty" aria-hidden="true">
            ◌
          </span>
        ) : state.showStill ? (
          <img
            className="avatar-field__still"
            src={state.stillUrl}
            alt=""
            aria-hidden="true"
          />
        ) : (
          // Once a person is wearing something other than the published
          // outfit, only the body itself can show what that is.
          <AvatarPreviewCanvas
            scene={state.scene}
            framing="full-body"
            label={`${state.modelName}, as it is saved`}
            className="avatar-field__preview"
          />
        )}
      </span>
      <span className="avatar-field__text">
        <small>{state.label}</small>
        <strong>{state.modelName}</strong>
        <small>
          {state.editable ? state.detail : `${state.detail} · fixed`}
        </small>
      </span>
      <span className="avatar-field__disclosure" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
