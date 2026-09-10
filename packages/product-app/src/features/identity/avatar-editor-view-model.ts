// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_CATALOG,
  avatarModelDefinition,
  clearAvatarSlot,
  editableSlots,
  equipWardrobeItem,
  equippedIn,
  resolveAvatarAppearance,
  resolveAvatarScene,
  serializeAvatarAppearance,
  validateAvatarAppearance,
  WARDROBE_ITEMS,
  wardrobeItemsFor,
  type AvatarAppearance,
  type AvatarModel,
  type AvatarSelection,
  type AvatarSlot,
  type ResolvedAvatarScene,
} from "@nilx-one/application";
import {
  avatarPreviewUrl,
  avatarWardrobeThumbnailUrl,
} from "@nilx-one/map-contract";

/** Whose body is being edited. An Avaia never wears its Bond's own study. */
export type AvatarSubject = "bond" | "avaia";

/**
 * The editor's own state, which is a draft and nothing else.
 *
 * Nothing here is persisted until a person says so, and a draft remembers what
 * each study was wearing while they move between studies — going back to a
 * body should find it as they left it, not reset to the published outfit.
 * Appearance is never carried across: what one study wears means nothing to
 * another, and a silent translation would put a person in clothes they never
 * chose.
 */
export interface AvatarDraft {
  readonly modelId: AvatarModel;
  readonly appearances: Readonly<
    Partial<Record<AvatarModel, AvatarAppearance>>
  >;
}

export function draftFromSelection(selection: AvatarSelection): AvatarDraft {
  return {
    modelId: selection.modelId,
    appearances: { [selection.modelId]: selection.appearance },
  };
}

export function draftAppearance(draft: AvatarDraft): AvatarAppearance {
  return resolveAvatarAppearance(
    draft.modelId,
    draft.appearances[draft.modelId],
  );
}

export function draftSelection(draft: AvatarDraft): AvatarSelection {
  return { modelId: draft.modelId, appearance: draftAppearance(draft) };
}

/** Move to another study, keeping what every study was already wearing. */
export function chooseDraftModel(
  draft: AvatarDraft,
  modelId: AvatarModel,
): AvatarDraft {
  return { ...draft, modelId };
}

function withAppearance(
  draft: AvatarDraft,
  appearance: AvatarAppearance,
): AvatarDraft {
  return {
    ...draft,
    appearances: { ...draft.appearances, [draft.modelId]: appearance },
  };
}

/**
 * Put one item on, or take it off again.
 *
 * Reaching for what is already on means taking it off, wherever the model
 * allows the slot to be empty — a person who wants bare feet reaches for the
 * shoes they are wearing rather than hunting for a control that says "none".
 * A slot the model requires cannot be emptied that way, and a change the model
 * refuses leaves the draft alone: an invalid combination is never something a
 * person has to undo.
 */
export function equipInDraft(draft: AvatarDraft, itemId: string): AvatarDraft {
  const appearance = draftAppearance(draft);
  const item = WARDROBE_ITEMS.find((entry) => entry.id === itemId);
  if (
    item !== undefined &&
    item.slot !== "accessories" &&
    equippedIn(appearance, item.slot).includes(itemId)
  ) {
    const cleared = clearAvatarSlot(draft.modelId, appearance, item.slot);
    return cleared.kind === "changed"
      ? withAppearance(draft, cleared.appearance)
      : draft;
  }
  const change = equipWardrobeItem(draft.modelId, appearance, itemId);
  return change.kind === "changed"
    ? withAppearance(draft, change.appearance)
    : draft;
}

export interface AvatarModelOptionViewState {
  readonly model: AvatarModel;
  readonly name: string;
  readonly detail: string;
  readonly thumbnailUrl: string;
  readonly selected: boolean;
  /** Whether this study's clothes can be changed at all. */
  readonly editable: boolean;
}

export interface WardrobeItemViewState {
  readonly id: string;
  readonly name: string;
  readonly thumbnailUrl: string;
  readonly selected: boolean;
}

export interface WardrobeSectionViewState {
  readonly slot: AvatarSlot;
  readonly label: string;
  readonly items: readonly WardrobeItemViewState[];
  /** True where a person may wear several at once. */
  readonly multiple: boolean;
}

export interface AvatarEditorViewState {
  readonly subject: AvatarSubject;
  readonly selected: AvatarModel;
  readonly selectedName: string;
  readonly models: readonly AvatarModelOptionViewState[];
  /** The body the preview and the world both draw from this draft. */
  readonly scene: ResolvedAvatarScene;
  readonly editable: boolean;
  /** Why this study offers a wardrobe, or why it does not. */
  readonly appearanceNote: string;
  readonly sections: readonly WardrobeSectionViewState[];
  readonly changed: boolean;
  readonly canSave: boolean;
  readonly busy: boolean;
  readonly error?: string;
  /** Said plainly, because an outfit does not leave this device yet. */
  readonly storageNote: string;
}

const SLOT_LABELS: Readonly<Record<AvatarSlot, string>> = {
  hair: "Hair",
  top: "Tops",
  bottom: "Bottoms",
  dress: "Dresses",
  outerwear: "Outerwear",
  shoes: "Shoes",
  headwear: "Headwear",
  accessories: "Accessories",
};

export interface AvatarEditorInput {
  readonly subject: AvatarSubject;
  /**
   * What is saved right now, which Cancel returns to. Absent while this
   * subject has chosen no body at all — an identity that chose nothing is not
   * the same as one wearing the default, and the editor says so by having
   * something to save from the first choice.
   */
  readonly persisted?: AvatarSelection | undefined;
  readonly draft: AvatarDraft;
  readonly busy: boolean;
  readonly error?: string | undefined;
}

function sameSelection(a: AvatarSelection, b: AvatarSelection): boolean {
  return (
    a.modelId === b.modelId &&
    serializeAvatarAppearance(a.appearance) ===
      serializeAvatarAppearance(b.appearance)
  );
}

export function createAvatarEditorViewState(
  input: AvatarEditorInput,
): AvatarEditorViewState {
  const selection = draftSelection(input.draft);
  const model = avatarModelDefinition(selection.modelId);
  const scene = resolveAvatarScene(selection.modelId, selection.appearance);
  const changed =
    input.persisted === undefined || !sameSelection(selection, input.persisted);
  const valid =
    validateAvatarAppearance(selection.modelId, selection.appearance).kind ===
    "valid";

  const sections = editableSlots(selection.modelId).map((schema) => {
    const worn = equippedIn(selection.appearance, schema.slot);
    return {
      slot: schema.slot,
      label: SLOT_LABELS[schema.slot],
      multiple: schema.cardinality === "many",
      items: wardrobeItemsFor(selection.modelId, schema.slot).map((item) => ({
        id: item.id,
        name: item.name,
        thumbnailUrl: avatarWardrobeThumbnailUrl(selection.modelId, item.id),
        selected: worn.includes(item.id),
      })),
    };
  });

  return {
    subject: input.subject,
    selected: selection.modelId,
    selectedName: model.name,
    models: AVATAR_CATALOG.map((entry) => ({
      model: entry.id,
      name: entry.name,
      detail: entry.detail,
      thumbnailUrl: avatarPreviewUrl(entry.id),
      selected: entry.id === selection.modelId,
      editable: entry.editable,
    })),
    scene,
    editable: model.editable,
    appearanceNote: model.editable
      ? "Hair, clothes and shoes are separate from the body. Changing them never changes who this study is."
      : `${model.name} is one sculpted study: this body has no separate clothes to change. Dasha 2.0 is the study that does.`,
    sections,
    changed,
    canSave: changed && valid && !input.busy,
    busy: input.busy,
    ...(input.error === undefined ? {} : { error: input.error }),
    storageNote:
      "The body is kept with this Bond. What it wears is kept on this device only.",
  };
}

/** What the settings field says about the body a subject is represented by. */
export interface AvatarFieldViewState {
  readonly label: string;
  readonly modelName: string;
  readonly detail: string;
  /** Absent while nothing has been chosen: there is no body to draw yet. */
  readonly scene?: ResolvedAvatarScene;
  readonly stillUrl?: string;
  /** A still is enough only while it is a still of this very outfit. */
  readonly showStill: boolean;
  readonly editable: boolean;
  readonly unchosen: boolean;
  readonly openLabel: string;
}

export function createAvatarFieldViewState(
  subject: AvatarSubject,
  selection: AvatarSelection | undefined,
): AvatarFieldViewState {
  const whose = subject === "bond" ? "your" : "this Avaia's";
  if (selection === undefined) {
    return {
      label: "3D model",
      modelName: "Not chosen",
      detail: "no body is drawn until you choose one",
      showStill: false,
      editable: false,
      unchosen: true,
      openLabel: `Choose ${whose} 3D model`,
    };
  }
  const model = avatarModelDefinition(selection.modelId);
  const scene = resolveAvatarScene(selection.modelId, selection.appearance);
  return {
    label: "3D model",
    modelName: model.name,
    detail: model.detail,
    scene,
    stillUrl: avatarPreviewUrl(selection.modelId),
    // A published still is a still of the published outfit. Once a person is
    // wearing something else, only the body itself can show what that is —
    // so the small preview stops standing in and draws it.
    showStill: scene.stillShowsThisAppearance,
    editable: model.editable,
    unchosen: false,
    openLabel: `Change ${whose} 3D model — currently ${model.name}`,
  };
}
