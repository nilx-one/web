// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from "react";

import { translateCopy, useLocalization } from "../../shell/localization";
import { AvatarPreviewCanvas } from "./avatar-preview-canvas";
import type { AvatarEditorViewState } from "./avatar-editor-view-model";

export interface AvatarEditorViewProps {
  readonly state: AvatarEditorViewState;
  readonly onChooseModel: (model: AvatarEditorViewState["selected"]) => void;
  readonly onEquip: (itemId: string) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
  /**
   * Present while the way back has asked whether to throw away a draft a
   * person changed. Staying keeps every choice; discarding is Cancel.
   */
  readonly leaving?: {
    readonly onStay: () => void;
    readonly onDiscard: () => void;
  };
}

/**
 * Where a person chooses the body they are represented by, and what it wears.
 *
 * Everything here is a draft. The preview answers immediately so a choice can
 * be seen rather than imagined, and nothing reaches the Bond until Save —
 * Cancel puts back exactly what was there.
 */
export function AvatarEditorView({
  state,
  onChooseModel,
  // Unused while the wardrobe sections below are hidden; see there.
  onEquip: _onEquip,
  onCancel,
  onSave,
  leaving,
}: AvatarEditorViewProps): React.ReactElement {
  const { t } = useLocalization();

  return (
    <div className="avatar-editor">
      {leaving === undefined ? null : (
        <LeavePrompt onStay={leaving.onStay} onDiscard={leaving.onDiscard} />
      )}

      <div className="avatar-editor__stage">
        <AvatarPreviewCanvas
          scene={state.scene}
          framing="full-body"
          label={t("avatar.preview.draft").replaceAll(
            "{name}",
            state.selectedName,
          )}
          className="avatar-editor__preview"
          animated
        />
      </div>

      <fieldset className="avatar-editor__models">
        <legend>{t("dock.model")}</legend>
        {state.models.map((option) => (
          <label
            key={option.model}
            className={`avatar-editor__model${
              option.selected ? " avatar-editor__model--selected" : ""
            }`}
          >
            <img src={option.thumbnailUrl} alt="" aria-hidden="true" />
            <span>
              <strong>{option.name}</strong>
              <small>{translateCopy(t, option.detail)}</small>
            </span>
            <input
              type="radio"
              name="avatar-model"
              value={option.model}
              checked={option.selected}
              disabled={state.busy}
              onChange={() => onChooseModel(option.model)}
            />
          </label>
        ))}
      </fieldset>

      <p className="avatar-editor__note">
        {translateCopy(t, state.appearanceNote)}
      </p>

      {/* Hidden for now: equipping an item here does not persist. Re-enable
          once that is fixed — onEquip and state.sections are untouched, only
          this rendering is suppressed.
      {state.sections.map((section) => (
        <WardrobeSection
          key={section.slot}
          slot={section.slot}
          label={section.label}
          multiple={section.multiple}
          items={section.items}
          busy={state.busy}
          onEquip={onEquip}
        />
      ))}
      */}

      {state.error === undefined ? null : (
        <p className="profile-edit__error" role="alert">
          {translateCopy(t, state.error)}
        </p>
      )}

      <p className="avatar-editor__note">
        {translateCopy(t, state.storageNote)}
      </p>

      <div className="avatar-editor__actions">
        <button type="button" onClick={onCancel} disabled={state.busy}>
          {t("dock.cancel")}
        </button>
        <button
          type="button"
          className="avatar-editor__save"
          onClick={onSave}
          disabled={!state.canSave}
        >
          {state.busy ? t("dock.saving") : t("dock.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * Asked at the top, right under the way back a person just reached for, and
 * focused on staying: the answer that loses nothing is the one a stray tap
 * lands on.
 */
function LeavePrompt({
  onStay,
  onDiscard,
}: NonNullable<AvatarEditorViewProps["leaving"]>): React.ReactElement {
  const { t } = useLocalization();
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
  }, []);

  return (
    <div className="avatar-editor__leave">
      <p role="alert">{t("dock.unsavedModel")}</p>
      <div className="avatar-editor__actions">
        <button type="button" onClick={onDiscard}>
          {t("dock.discardChanges")}
        </button>
        <button
          type="button"
          className="avatar-editor__save"
          ref={stay}
          onClick={onStay}
        >
          {t("dock.keepEditing")}
        </button>
      </div>
    </div>
  );
}

// Hidden for now, along with its call site above. Kept whole rather than
// deleted so restoring the wardrobe sections is one uncomment, not a rewrite.
//
// interface WardrobeSectionProps {
//   readonly slot: AvatarSlot;
//   readonly label: string;
//   readonly multiple: boolean;
//   readonly items: AvatarEditorViewState["sections"][number]["items"];
//   readonly busy: boolean;
//   readonly onEquip: (itemId: string) => void;
// }
//
// function WardrobeSection({
//   slot,
//   label,
//   multiple,
//   items,
//   busy,
//   onEquip,
// }: WardrobeSectionProps): React.ReactElement {
//   return (
//     <section className="wardrobe" aria-labelledby={`wardrobe-${slot}`}>
//       <h3 id={`wardrobe-${slot}`}>{label}</h3>
//       <ul className="wardrobe__items">
//         {items.map((item) => (
//           <li key={item.id}>
//             <button
//               type="button"
//               className={`wardrobe__item${
//                 item.selected ? " wardrobe__item--worn" : ""
//               }`}
//               // A picker where one thing is on is a set of radios; one where
//               // several may be is a set of switches. Saying which it is out
//               // loud is what lets it be used without seeing it.
//               role={multiple ? "switch" : "radio"}
//               aria-checked={item.selected}
//               disabled={busy}
//               onClick={() => onEquip(item.id)}
//             >
//               <img src={item.thumbnailUrl} alt="" aria-hidden="true" />
//               <span>{item.name}</span>
//             </button>
//           </li>
//         ))}
//       </ul>
//     </section>
//   );
// }
