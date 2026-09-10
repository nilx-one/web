// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { AVATAR_MODELS, type AvatarModel } from "./identity-registration";

/**
 * A body is not an outfit.
 *
 * The model a person chose is who they are represented by; appearance is what
 * that body is currently wearing. The two are stored, validated and rendered
 * apart so that changing a shirt can never quietly change an identity, and so
 * that a study which publishes no wardrobe at all is still a first-class
 * choice rather than a degenerate case of one that does.
 */

/** A semantic attachment category a wearable occupies. */
export type AvatarSlot =
  | "hair"
  | "top"
  | "bottom"
  | "dress"
  | "outerwear"
  | "shoes"
  | "headwear"
  | "accessories";

/**
 * The order slots are presented in, wherever a wardrobe is shown. It is part
 * of the contract rather than of a screen, so the editor, a future native
 * renderer and any test all read the same wardrobe in the same order.
 */
export const AVATAR_SLOTS: readonly AvatarSlot[] = [
  "hair",
  "top",
  "bottom",
  "dress",
  "outerwear",
  "shoes",
  "headwear",
  "accessories",
];

/**
 * A region of the body a wearable may cover.
 *
 * Covering is visibility, never geometry: a garment hides the region it
 * encloses so that skin does not push through cloth, and unequipping it
 * restores exactly what was there. Nothing is cut away, so no sequence of
 * changes can leave a body permanently missing a part of itself.
 */
export type AvatarBodyRegion =
  | "torso"
  | "upper_arms"
  | "lower_arms"
  | "hips"
  | "upper_legs"
  | "lower_legs"
  | "feet";

export const AVATAR_BODY_REGIONS: readonly AvatarBodyRegion[] = [
  "torso",
  "upper_arms",
  "lower_arms",
  "hips",
  "upper_legs",
  "lower_legs",
  "feet",
];

/** How many items a slot may hold at once. */
export type AvatarSlotCardinality = "one" | "zero-or-one" | "many";

export interface AvatarSlotSchema {
  readonly slot: AvatarSlot;
  readonly cardinality: AvatarSlotCardinality;
  /**
   * Slots this one cannot be worn beside. A dress is the whole garment, so it
   * is the same cloth as a top and a bottom rather than a layer over them.
   * Declared once here and enforced symmetrically, so neither side of a
   * conflict can be equipped into a combination the other forbids.
   */
  readonly conflicts: readonly AvatarSlot[];
}

/**
 * What a model publishes as editable. A model with no slots publishes no
 * wardrobe, which is the honest way to say that its appearance is fixed —
 * rather than offering controls that would change nothing.
 */
export interface AvatarAppearanceSchema {
  readonly rigVersion: string;
  readonly slots: readonly AvatarSlotSchema[];
}

/**
 * Model-specific visual state layered over a chosen body.
 *
 * It is interpreted only by the schema of the model it belongs to. An
 * appearance written for one study is never carried silently onto another:
 * unknown or unsupported entries are dropped rather than approximated, so a
 * body can never be dressed in something that was never made for it.
 */
export interface AvatarAppearance {
  readonly hair?: string;
  readonly top?: string;
  readonly bottom?: string;
  readonly dress?: string;
  readonly outerwear?: string;
  readonly shoes?: string;
  readonly headwear?: string;
  readonly accessories?: readonly string[];
}

/** The body a subject is represented by, together with what it is wearing. */
export interface AvatarSelection {
  readonly modelId: AvatarModel;
  readonly appearance: AvatarAppearance;
}

/**
 * What kind of appearance a model has at all. `static-appearance` is not a
 * missing feature: three published studies are single sculpted bodies, and
 * saying so is what keeps the editor from implying otherwise.
 */
export type AvatarAppearanceCapability =
  "static-appearance" | "modular-appearance";

export interface AvatarModelDefinition {
  readonly id: AvatarModel;
  /** The study's own name. */
  readonly name: string;
  /** How the study reads, in the person's own terms rather than a category. */
  readonly detail: string;
  readonly capability: AvatarAppearanceCapability;
  /**
   * Whether anything about this body's appearance may be changed. Only Dasha
   * 2.0 was authored as a modular character; the original three studies are
   * baked sculptures, and offering them a wardrobe would promise a change the
   * asset cannot make.
   */
  readonly editable: boolean;
  /** The asset version this study's geometry is published under. */
  readonly assetVersion: string;
  readonly schema: AvatarAppearanceSchema;
  readonly defaultAppearance: AvatarAppearance;
}

/**
 * An equipable item. It declares which models and which rig it was authored
 * for, so compatibility is a fact the item carries rather than something the
 * renderer discovers when a sleeve ends up in the wrong place.
 */
export interface WardrobeItem {
  /** A stable semantic id such as `top/tee-black`. Never a URL or a path. */
  readonly id: string;
  readonly slot: AvatarSlot;
  readonly name: string;
  readonly supportedModels: readonly AvatarModel[];
  readonly rigVersion: string;
  /** Body regions this item encloses, hidden while it is worn. */
  readonly hides: readonly AvatarBodyRegion[];
}

/** The rig contract Dasha 2.0's body and every one of her wearables share. */
export const DASHA_2_RIG_VERSION = "study-rig-1";

const NO_SLOTS: AvatarAppearanceSchema = {
  rigVersion: DASHA_2_RIG_VERSION,
  slots: [],
};

const DASHA_2_SCHEMA: AvatarAppearanceSchema = {
  rigVersion: DASHA_2_RIG_VERSION,
  slots: [
    { slot: "hair", cardinality: "one", conflicts: [] },
    { slot: "top", cardinality: "zero-or-one", conflicts: ["dress"] },
    { slot: "bottom", cardinality: "zero-or-one", conflicts: ["dress"] },
    { slot: "dress", cardinality: "zero-or-one", conflicts: ["top", "bottom"] },
    { slot: "outerwear", cardinality: "zero-or-one", conflicts: [] },
    { slot: "shoes", cardinality: "zero-or-one", conflicts: [] },
    { slot: "headwear", cardinality: "zero-or-one", conflicts: [] },
    { slot: "accessories", cardinality: "many", conflicts: [] },
  ],
};

function dasha2Item(
  id: string,
  slot: AvatarSlot,
  name: string,
  hides: readonly AvatarBodyRegion[],
): WardrobeItem {
  return {
    id,
    slot,
    name,
    supportedModels: ["dasha-v2-study"],
    rigVersion: DASHA_2_RIG_VERSION,
    hides,
  };
}

/**
 * Dasha 2.0's initial wardrobe. It is deliberately more than one outfit: a
 * modular character that ships a single fixed set of clothes has not been
 * shown to be modular at all.
 */
export const WARDROBE_ITEMS: readonly WardrobeItem[] = [
  dasha2Item("hair/swept-bun", "hair", "Swept bun", []),
  dasha2Item("hair/loose-long", "hair", "Loose length", []),
  // A short sleeve does not enclose the arm below its hem, so the arm regions
  // stay published for a long-sleeved item and hidden by nothing yet.
  dasha2Item("top/tee-black", "top", "Black tee", ["torso"]),
  dasha2Item("top/shell-ecru", "top", "Ecru shell", ["torso"]),
  dasha2Item("bottom/trousers-ecru", "bottom", "Ecru trousers", [
    "hips",
    "upper_legs",
    "lower_legs",
  ]),
  dasha2Item("bottom/skirt-charcoal", "bottom", "Charcoal skirt", [
    "hips",
    "upper_legs",
  ]),
  dasha2Item("dress/shift-indigo", "dress", "Indigo shift", [
    "torso",
    "hips",
    "upper_legs",
  ]),
  dasha2Item("shoes/loafers-black", "shoes", "Black loafers", ["feet"]),
  dasha2Item("shoes/sneakers-white", "shoes", "White sneakers", ["feet"]),
  dasha2Item("accessory/earrings-silver", "accessories", "Silver earrings", []),
];

const WARDROBE_BY_ID: ReadonlyMap<string, WardrobeItem> = new Map(
  WARDROBE_ITEMS.map((item) => [item.id, item]),
);

const DASHA_2_DEFAULT_APPEARANCE: AvatarAppearance = {
  hair: "hair/swept-bun",
  top: "top/tee-black",
  bottom: "bottom/trousers-ecru",
  shoes: "shoes/loafers-black",
  accessories: ["accessory/earrings-silver"],
};

function staticStudy(
  id: AvatarModel,
  name: string,
  detail: string,
): AvatarModelDefinition {
  return {
    id,
    name,
    detail,
    capability: "static-appearance",
    editable: false,
    assetVersion: "0.1.0",
    schema: NO_SLOTS,
    defaultAppearance: {},
  };
}

/**
 * Every study this client publishes, in the order a picker shows them. Exactly
 * four are registered, and registering a study is what makes it selectable —
 * an asset on disk that no definition names is not a choice anyone can make.
 */
export const AVATAR_CATALOG: readonly AvatarModelDefinition[] = [
  staticStudy("sky-study", "Sky", "masculine study"),
  staticStudy("dasha-study", "Dasha", "feminine study"),
  staticStudy("kai-study", "Kai", "non-binary study"),
  {
    id: "dasha-v2-study",
    name: "Dasha 2.0",
    detail: "feminine study · changeable clothes",
    capability: "modular-appearance",
    editable: true,
    assetVersion: "0.3.0",
    schema: DASHA_2_SCHEMA,
    defaultAppearance: DASHA_2_DEFAULT_APPEARANCE,
  },
];

const CATALOG_BY_ID: ReadonlyMap<AvatarModel, AvatarModelDefinition> = new Map(
  AVATAR_CATALOG.map((definition) => [definition.id, definition]),
);

export function isPublishedAvatarModel(value: string): value is AvatarModel {
  return CATALOG_BY_ID.has(value as AvatarModel);
}

/** The definition of a published study. Every published id has exactly one. */
export function avatarModelDefinition(id: AvatarModel): AvatarModelDefinition {
  const definition = CATALOG_BY_ID.get(id);
  if (definition === undefined) {
    throw new Error(`unregistered avatar model: ${id}`);
  }
  return definition;
}

/** Whether this study's appearance may be changed at all. */
export function isAvatarModelEditable(id: AvatarModel): boolean {
  return avatarModelDefinition(id).editable;
}

export function wardrobeItem(id: string): WardrobeItem | undefined {
  return WARDROBE_BY_ID.get(id);
}

/** Whether an item was authored for this body and this rig. */
export function supportsAvatarModel(
  item: WardrobeItem,
  model: AvatarModelDefinition,
): boolean {
  return (
    item.supportedModels.includes(model.id) &&
    item.rigVersion === model.schema.rigVersion
  );
}

/** The items a model may equip into one slot, in catalog order. */
export function wardrobeItemsFor(
  id: AvatarModel,
  slot: AvatarSlot,
): readonly WardrobeItem[] {
  const model = avatarModelDefinition(id);
  if (!model.editable) return [];
  return WARDROBE_ITEMS.filter(
    (item) => item.slot === slot && supportsAvatarModel(item, model),
  );
}

/** The slots this model actually publishes, in contract order. */
export function editableSlots(id: AvatarModel): readonly AvatarSlotSchema[] {
  const model = avatarModelDefinition(id);
  if (!model.editable) return [];
  return AVATAR_SLOTS.flatMap((slot) => {
    const schema = model.schema.slots.find((entry) => entry.slot === slot);
    return schema === undefined || wardrobeItemsFor(id, slot).length === 0
      ? []
      : [schema];
  });
}

type AppearanceDraft = {
  -readonly [K in keyof AvatarAppearance]: AvatarAppearance[K];
};

/** What a slot currently holds, as a list whatever its cardinality. */
export function equippedIn(
  appearance: AvatarAppearance,
  slot: AvatarSlot,
): readonly string[] {
  if (slot === "accessories") return appearance.accessories ?? [];
  const value = appearance[slot];
  return value === undefined ? [] : [value];
}

function writeSlot(
  draft: AppearanceDraft,
  slot: AvatarSlot,
  values: readonly string[],
): void {
  if (slot === "accessories") {
    if (values.length > 0) draft.accessories = [...values];
    else delete draft.accessories;
    return;
  }
  const [first] = values;
  if (first === undefined) delete draft[slot];
  else draft[slot] = first;
}

function draftOf(appearance: AvatarAppearance): AppearanceDraft {
  const draft: AppearanceDraft = {};
  for (const slot of AVATAR_SLOTS)
    writeSlot(draft, slot, equippedIn(appearance, slot));
  return draft;
}

/** Why an appearance, or one change to it, is not something this body may wear. */
export type AvatarAppearanceRejection =
  | { readonly kind: "model-not-editable"; readonly slot: AvatarSlot }
  | { readonly kind: "unpublished-slot"; readonly slot: AvatarSlot }
  | {
      readonly kind: "unknown-item";
      readonly slot: AvatarSlot;
      readonly itemId: string;
    }
  | {
      readonly kind: "unsupported-item";
      readonly slot: AvatarSlot;
      readonly itemId: string;
    }
  | {
      readonly kind: "wrong-slot";
      readonly slot: AvatarSlot;
      readonly itemId: string;
    }
  | {
      readonly kind: "slot-conflict";
      readonly slot: AvatarSlot;
      readonly conflictsWith: AvatarSlot;
    }
  | { readonly kind: "too-many-items"; readonly slot: AvatarSlot }
  | {
      readonly kind: "duplicate-item";
      readonly slot: AvatarSlot;
      readonly itemId: string;
    }
  | { readonly kind: "missing-required-slot"; readonly slot: AvatarSlot };

export type AvatarAppearanceValidation =
  | { readonly kind: "valid" }
  | {
      readonly kind: "invalid";
      readonly rejections: readonly AvatarAppearanceRejection[];
    };

function slotSchema(
  model: AvatarModelDefinition,
  slot: AvatarSlot,
): AvatarSlotSchema | undefined {
  return model.schema.slots.find((entry) => entry.slot === slot);
}

/**
 * Whether this exact appearance is one the chosen body may wear.
 *
 * Nothing is repaired here: an appearance that is going to be persisted is
 * either something the model published or it is refused, so an invalid
 * combination can never be committed and then silently corrected on read.
 */
export function validateAvatarAppearance(
  id: AvatarModel,
  appearance: AvatarAppearance,
): AvatarAppearanceValidation {
  const model = avatarModelDefinition(id);
  const rejections: AvatarAppearanceRejection[] = [];
  const occupied: AvatarSlot[] = [];

  for (const slot of AVATAR_SLOTS) {
    const values = equippedIn(appearance, slot);
    if (values.length === 0) continue;
    if (!model.editable) {
      rejections.push({ kind: "model-not-editable", slot });
      continue;
    }
    const schema = slotSchema(model, slot);
    if (schema === undefined) {
      rejections.push({ kind: "unpublished-slot", slot });
      continue;
    }
    if (schema.cardinality !== "many" && values.length > 1) {
      rejections.push({ kind: "too-many-items", slot });
    }
    const seen = new Set<string>();
    for (const itemId of values) {
      if (seen.has(itemId)) {
        rejections.push({ kind: "duplicate-item", slot, itemId });
        continue;
      }
      seen.add(itemId);
      const item = wardrobeItem(itemId);
      if (item === undefined) {
        rejections.push({ kind: "unknown-item", slot, itemId });
      } else if (item.slot !== slot) {
        rejections.push({ kind: "wrong-slot", slot, itemId });
      } else if (!supportsAvatarModel(item, model)) {
        rejections.push({ kind: "unsupported-item", slot, itemId });
      }
    }
    for (const other of occupied) {
      if (schema.conflicts.includes(other)) {
        rejections.push({ kind: "slot-conflict", slot, conflictsWith: other });
      }
    }
    occupied.push(slot);
  }

  if (model.editable) {
    for (const schema of model.schema.slots) {
      if (
        schema.cardinality === "one" &&
        equippedIn(appearance, schema.slot).length === 0
      ) {
        rejections.push({ kind: "missing-required-slot", slot: schema.slot });
      }
    }
  }

  return rejections.length === 0
    ? { kind: "valid" }
    : { kind: "invalid", rejections };
}

/**
 * The appearance a body is actually drawn in, for any stored value at all.
 *
 * Reading has to survive state this client did not write: an appearance saved
 * by a newer runtime, one carried over from another study, one whose items
 * were never published here. Every such entry is dropped rather than guessed
 * at, and what is left is completed from the model's own default — so the same
 * stored value always resolves to the same body, and a body is never left
 * standing in a combination nothing authored.
 */
export function resolveAvatarAppearance(
  id: AvatarModel,
  appearance: AvatarAppearance | undefined,
): AvatarAppearance {
  const model = avatarModelDefinition(id);
  if (!model.editable) return Object.freeze({});

  // Nothing stored at all is not the same as a body deliberately wearing
  // nothing: an identity that has never opened the editor is dressed in the
  // model's own default, while one that took its shoes off stays barefoot.
  const stored = appearance ?? model.defaultAppearance;
  const draft: AppearanceDraft = {};
  const kept: AvatarSlot[] = [];
  for (const schema of orderedSlots(model)) {
    const supported = keepSupported(
      model,
      schema,
      equippedIn(stored, schema.slot),
    );
    if (supported.length === 0) continue;
    if (schema.conflicts.some((other) => kept.includes(other))) continue;
    writeSlot(draft, schema.slot, supported);
    kept.push(schema.slot);
  }

  for (const schema of orderedSlots(model)) {
    if (schema.cardinality !== "one") continue;
    if (equippedIn(draft, schema.slot).length > 0) continue;
    const fallback =
      keepSupported(
        model,
        schema,
        equippedIn(model.defaultAppearance, schema.slot),
      )[0] ?? wardrobeItemsFor(model.id, schema.slot)[0]?.id;
    if (fallback !== undefined) writeSlot(draft, schema.slot, [fallback]);
  }

  return Object.freeze(draft);
}

function orderedSlots(
  model: AvatarModelDefinition,
): readonly AvatarSlotSchema[] {
  return AVATAR_SLOTS.flatMap((slot) => {
    const schema = slotSchema(model, slot);
    return schema === undefined ? [] : [schema];
  });
}

function keepSupported(
  model: AvatarModelDefinition,
  schema: AvatarSlotSchema,
  values: readonly string[],
): readonly string[] {
  const kept: string[] = [];
  for (const itemId of values) {
    if (kept.includes(itemId)) continue;
    const item = wardrobeItem(itemId);
    if (item === undefined) continue;
    if (item.slot !== schema.slot) continue;
    if (!supportsAvatarModel(item, model)) continue;
    kept.push(itemId);
    if (schema.cardinality !== "many") break;
  }
  return kept;
}

export type WardrobeChange =
  | { readonly kind: "changed"; readonly appearance: AvatarAppearance }
  | { readonly kind: "rejected"; readonly reason: AvatarAppearanceRejection };

/**
 * Put one item on.
 *
 * A slot that may hold many toggles; a slot that holds one is replaced. Cloth
 * that cannot be worn beside what is already on comes off in the same change
 * rather than leaving the body in a combination that would have to be
 * refused at save time — a person choosing a dress means the dress.
 */
export function equipWardrobeItem(
  id: AvatarModel,
  appearance: AvatarAppearance,
  itemId: string,
): WardrobeChange {
  const model = avatarModelDefinition(id);
  const item = wardrobeItem(itemId);
  if (item === undefined) {
    return {
      kind: "rejected",
      reason: { kind: "unknown-item", slot: "accessories", itemId },
    };
  }
  if (!model.editable) {
    return {
      kind: "rejected",
      reason: { kind: "model-not-editable", slot: item.slot },
    };
  }
  const schema = slotSchema(model, item.slot);
  if (schema === undefined) {
    return {
      kind: "rejected",
      reason: { kind: "unpublished-slot", slot: item.slot },
    };
  }
  if (!supportsAvatarModel(item, model)) {
    return {
      kind: "rejected",
      reason: { kind: "unsupported-item", slot: item.slot, itemId },
    };
  }

  const draft = draftOf(appearance);
  if (schema.cardinality === "many") {
    const worn = equippedIn(appearance, item.slot);
    const next = worn.includes(itemId)
      ? worn.filter((entry) => entry !== itemId)
      : [...worn, itemId];
    writeSlot(draft, item.slot, next);
  } else {
    writeSlot(draft, item.slot, [itemId]);
    for (const other of schema.conflicts) writeSlot(draft, other, []);
    for (const entry of model.schema.slots) {
      if (entry.conflicts.includes(item.slot)) writeSlot(draft, entry.slot, []);
    }
  }
  return { kind: "changed", appearance: Object.freeze(draft) };
}

/** Take a slot off. A slot the model requires cannot be emptied. */
export function clearAvatarSlot(
  id: AvatarModel,
  appearance: AvatarAppearance,
  slot: AvatarSlot,
): WardrobeChange {
  const model = avatarModelDefinition(id);
  if (!model.editable) {
    return { kind: "rejected", reason: { kind: "model-not-editable", slot } };
  }
  const schema = slotSchema(model, slot);
  if (schema === undefined) {
    return { kind: "rejected", reason: { kind: "unpublished-slot", slot } };
  }
  if (schema.cardinality === "one") {
    return {
      kind: "rejected",
      reason: { kind: "missing-required-slot", slot },
    };
  }
  const draft = draftOf(appearance);
  writeSlot(draft, slot, []);
  return { kind: "changed", appearance: Object.freeze(draft) };
}

/**
 * The body regions the equipped cloth encloses.
 *
 * Derived every time from what is worn, never accumulated: a region is hidden
 * exactly while something covers it, so taking a garment off restores the body
 * underneath without any record of what was hidden needing to be kept.
 */
export function hiddenBodyRegions(
  id: AvatarModel,
  appearance: AvatarAppearance,
): readonly AvatarBodyRegion[] {
  const model = avatarModelDefinition(id);
  if (!model.editable) return [];
  const hidden = new Set<AvatarBodyRegion>();
  for (const slot of AVATAR_SLOTS) {
    for (const itemId of equippedIn(appearance, slot)) {
      const item = wardrobeItem(itemId);
      if (item === undefined || !supportsAvatarModel(item, model)) continue;
      for (const region of item.hides) hidden.add(region);
    }
  }
  return AVATAR_BODY_REGIONS.filter((region) => hidden.has(region));
}

/** Every item worn right now, in contract slot order. */
export function equippedWardrobe(
  id: AvatarModel,
  appearance: AvatarAppearance,
): readonly WardrobeItem[] {
  const model = avatarModelDefinition(id);
  if (!model.editable) return [];
  return AVATAR_SLOTS.flatMap((slot) =>
    equippedIn(appearance, slot).flatMap((itemId) => {
      const item = wardrobeItem(itemId);
      return item !== undefined && supportsAvatarModel(item, model)
        ? [item]
        : [];
    }),
  );
}

/**
 * A stable text form of an appearance.
 *
 * Slots are written in contract order and empty ones are omitted, so the same
 * appearance always produces the same bytes — which is what lets a stored
 * value be compared for change without re-resolving it first.
 */
export function serializeAvatarAppearance(
  appearance: AvatarAppearance,
): string {
  const ordered: Record<string, string | readonly string[]> = {};
  for (const slot of AVATAR_SLOTS) {
    const values = equippedIn(appearance, slot);
    if (values.length === 0) continue;
    ordered[slot] = slot === "accessories" ? values : (values[0] as string);
  }
  return JSON.stringify(ordered);
}

/**
 * Read a stored appearance back. Anything that is not an appearance this model
 * publishes resolves to the model's own default rather than throwing: a body
 * still has to be drawn.
 */
export function parseAvatarAppearance(
  id: AvatarModel,
  text: string | undefined,
): AvatarAppearance {
  if (text === undefined || text.length === 0) {
    return resolveAvatarAppearance(id, undefined);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return resolveAvatarAppearance(id, undefined);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return resolveAvatarAppearance(id, undefined);
  }
  const record = value as Record<string, unknown>;
  const draft: AppearanceDraft = {};
  for (const slot of AVATAR_SLOTS) {
    const entry = record[slot];
    if (slot === "accessories") {
      if (Array.isArray(entry)) {
        writeSlot(
          draft,
          slot,
          entry.filter((item): item is string => typeof item === "string"),
        );
      }
      continue;
    }
    if (typeof entry === "string") writeSlot(draft, slot, [entry]);
  }
  return resolveAvatarAppearance(id, draft);
}

/**
 * The selection a subject is rendered from, for any stored pair at all. A
 * model this client does not publish has no selection: an explicit unsupported
 * choice stays unsupported rather than being replaced by another study.
 */
export function resolveAvatarSelection(
  modelId: string | undefined,
  appearance: AvatarAppearance | undefined,
): AvatarSelection | undefined {
  if (modelId === undefined || !isPublishedAvatarModel(modelId)) {
    return undefined;
  }
  return {
    modelId,
    appearance: resolveAvatarAppearance(modelId, appearance),
  };
}

/** Guards the catalog against drifting away from the identity contract. */
export const REGISTERED_AVATAR_MODELS: readonly AvatarModel[] =
  AVATAR_CATALOG.map((definition) => definition.id);

export const AVATAR_CATALOG_MATCHES_IDENTITY: boolean =
  REGISTERED_AVATAR_MODELS.length === AVATAR_MODELS.length &&
  AVATAR_MODELS.every((model) => CATALOG_BY_ID.has(model));
