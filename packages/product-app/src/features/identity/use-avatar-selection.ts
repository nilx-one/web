// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  isPublishedAvatarModel,
  parseAvatarAppearance,
  serializeAvatarAppearance,
  type AvatarModel,
  type AvatarSelection,
} from "@nilx-one/application";
import { useCallback, useMemo } from "react";

import type { AvatarSubject } from "./avatar-editor-view-model";
import {
  readAvatarChoice,
  useAvatarChoice,
  writeAvatarChoice,
} from "./avatar-wardrobe-store";

/**
 * What a subject looks like right now, read from wherever each half is kept.
 *
 * The body a Bond chose is the identity service's, so it is read from the
 * projection this client already holds. What that body wears is this device's,
 * because the contract publishes no field for it. Reading them together in one
 * place is what keeps the two halves from being resolved differently on
 * different screens.
 */
export function useAvatarSelection(
  address: string,
  modelId: AvatarModel | undefined,
): AvatarSelection | undefined {
  const stored = useAvatarChoice(address);
  return useMemo(() => {
    const chosen =
      modelId ??
      (stored.modelId !== undefined && isPublishedAvatarModel(stored.modelId)
        ? stored.modelId
        : undefined);
    if (chosen === undefined) return undefined;
    return {
      modelId: chosen,
      appearance: parseAvatarAppearance(chosen, stored.appearances?.[chosen]),
    };
  }, [modelId, stored]);
}

export interface AvatarCommit {
  readonly subject: AvatarSubject;
  readonly address: string;
  readonly selection: AvatarSelection;
  /** True where the model itself is this device's to remember. */
  readonly modelIsLocal: boolean;
}

/**
 * Write a committed selection down.
 *
 * The Bond's own body goes to the identity service, which is why it is not
 * written here; everything this device is responsible for is. An outfit stays
 * on this device, and the editor says so rather than letting a person assume
 * it followed them.
 */
export function useCommitAvatarSelection(): (commit: AvatarCommit) => void {
  return useCallback(({ address, selection, modelIsLocal }: AvatarCommit) => {
    const previous = readAvatarChoice(address);
    const appearance = serializeAvatarAppearance(selection.appearance);
    // What the other studies were wearing is left exactly as it was: choosing
    // a different body is not a reason to forget how this one was dressed.
    const appearances = { ...previous.appearances };
    if (appearance === "{}") delete appearances[selection.modelId];
    else appearances[selection.modelId] = appearance;
    writeAvatarChoice(address, {
      ...(modelIsLocal
        ? { modelId: selection.modelId }
        : previous.modelId === undefined
          ? {}
          : { modelId: previous.modelId }),
      ...(Object.keys(appearances).length === 0 ? {} : { appearances }),
    });
  }, []);
}
