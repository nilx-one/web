// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_BODY_REGIONS,
  avatarModelDefinition,
  equippedWardrobe,
  hiddenBodyRegions,
  resolveAvatarAppearance,
  serializeAvatarAppearance,
  type AvatarAppearance,
  type AvatarBodyRegion,
  type AvatarSelection,
  type WardrobeItem,
} from "./avatar-appearance";
import type { AvatarModel } from "./identity-registration";

/**
 * How the asset names the parts an appearance shows and hides.
 *
 * A namespaced name is a part the application decides the visibility of; a
 * bare name is the asset's own — a bone, an armature — and is never touched.
 * The domain owns the namespaces because it owns what a body is made of; a
 * renderer only has to know that a namespaced node is not its business to
 * decide about.
 */
export const AVATAR_NODE_SEPARATOR = ":";

export function avatarBodyRegionNode(region: string): string {
  return `body${AVATAR_NODE_SEPARATOR}${region}`;
}

export function avatarWardrobeNode(itemId: string): string {
  return `wear${AVATAR_NODE_SEPARATOR}${itemId}`;
}

/**
 * The parts of a body it keeps whatever it is wearing.
 *
 * Nothing a person can put on may hide them, which is why they are named apart
 * from the coverable regions rather than listed among them. A body that could
 * lose its own face to a change of clothes would not be the same body
 * afterwards.
 */
export const AVATAR_IDENTITY_REGIONS: readonly string[] = ["head", "hands"];

/** The mesh nodes a modular study always draws, by name. */
export const AVATAR_IDENTITY_NODES: readonly string[] =
  AVATAR_IDENTITY_REGIONS.map((region) => avatarBodyRegionNode(region));

/**
 * One resolved body, and the only thing anything draws.
 *
 * Settings, the editor and the world all resolve through here, so the same
 * persisted state cannot look like one body in a preview and another one
 * standing on the map. It says which geometry to fetch and which of that
 * geometry's nodes this appearance shows — never how to draw them, and
 * never anything about a renderer.
 */
export interface ResolvedAvatarScene {
  readonly modelId: AvatarModel;
  /** The appearance actually drawn, after every unsupported entry is dropped. */
  readonly appearance: AvatarAppearance;
  /**
   * Whether the study's published still is a still of this very outfit rather
   * than only of the study. A small preview may fall back to that still, and
   * should not claim more than it shows.
   */
  readonly stillShowsThisAppearance: boolean;
  /**
   * The mesh nodes this appearance draws. Empty for a study that publishes
   * none, which means the asset is drawn exactly as it was authored.
   */
  readonly visibleNodes: readonly string[];
  readonly hiddenRegions: readonly AvatarBodyRegion[];
  readonly equipped: readonly WardrobeItem[];
  readonly modular: boolean;
  /**
   * A stable identity for this resolved body. Two scenes with the same key
   * draw the same thing, which is what lets a preview skip work it has
   * already done rather than reload a body that did not change.
   */
  readonly key: string;
}

/**
 * Resolve a persisted selection into the one body every consumer draws.
 *
 * The appearance is re-resolved rather than trusted: reading has to survive
 * state a newer runtime wrote, so what comes back is always something this
 * client can actually stand up.
 */
export function resolveAvatarScene(
  modelId: AvatarModel,
  appearance: AvatarAppearance | undefined,
): ResolvedAvatarScene {
  const model = avatarModelDefinition(modelId);
  const resolved = resolveAvatarAppearance(modelId, appearance);
  const hidden = hiddenBodyRegions(modelId, resolved);
  const equipped = equippedWardrobe(modelId, resolved);
  const serialized = serializeAvatarAppearance(resolved);

  const visibleNodes = model.editable
    ? [
        ...AVATAR_IDENTITY_NODES,
        ...AVATAR_BODY_REGIONS.filter((region) => !hidden.includes(region)).map(
          (region) => avatarBodyRegionNode(region),
        ),
        ...equipped.map((item) => avatarWardrobeNode(item.id)),
      ]
    : [];

  return {
    modelId,
    appearance: resolved,
    stillShowsThisAppearance:
      serialized === serializeAvatarAppearance(model.defaultAppearance),
    visibleNodes,
    hiddenRegions: hidden,
    equipped,
    modular: model.editable,
    key: `${modelId}#${serialized}`,
  };
}

/** The same resolution, from a selection a subject already holds. */
export function resolveSelectedAvatarScene(
  selection: AvatarSelection,
): ResolvedAvatarScene {
  return resolveAvatarScene(selection.modelId, selection.appearance);
}

/**
 * Whether a node the asset publishes is drawn by this scene. A study with no
 * published nodes draws all of its own geometry, which is what "this asset is
 * one sculpted body" means to a renderer.
 */
export function sceneDrawsNode(
  scene: ResolvedAvatarScene,
  node: string,
): boolean {
  return !scene.modular || scene.visibleNodes.includes(node);
}
