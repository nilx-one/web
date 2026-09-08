// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_MODELS,
  type AvatarModel,
  type AvatarModelResult,
} from "@nilx-one/application";

/**
 * The body a Bond is represented by. Three published studies, chosen by the
 * person; nobody is assigned one. Until a choice exists the world draws the
 * neutral study, and the profile says that no choice has been made rather than
 * showing one as if it had.
 */
export const DEFAULT_AVATAR_MODEL: AvatarModel = "kai-study";

export interface AvatarOptionViewState {
  readonly model: AvatarModel;
  /** The study's own name. */
  readonly name: string;
  /** How the study reads, in the person's own terms rather than a category. */
  readonly detail: string;
  readonly selected: boolean;
}

export interface AvatarChoiceViewState {
  readonly options: readonly AvatarOptionViewState[];
  /** The model the world draws right now, chosen or not. */
  readonly rendered: AvatarModel;
  /** True while no choice has been recorded for this Bond. */
  readonly unchosen: boolean;
  readonly busy: boolean;
  readonly error?: string;
}

const STUDIES: Readonly<Record<AvatarModel, { name: string; detail: string }>> =
  {
    "sky-study": { name: "Sky", detail: "masculine study" },
    "dasha-study": { name: "Dasha", detail: "feminine study" },
    "kai-study": { name: "Kai", detail: "non-binary study" },
  };

function chooseError(result: AvatarModelResult): string | undefined {
  if (result.kind === "service-unavailable")
    return "Couldn’t save this choice. Try again.";
  if (result.kind !== "rejected") return undefined;
  switch (result.reason) {
    case "authentication-required":
      return "Sign in again to change this.";
    case "unknown-model":
      return "That study is not published.";
    case "rate-limited":
      return "Too many changes. Wait before trying again.";
  }
}

export function createAvatarChoiceViewState(
  chosen: AvatarModel | undefined,
  pending: AvatarModel | undefined,
  result?: AvatarModelResult,
): AvatarChoiceViewState {
  // An in-flight choice is shown as selected: the person already made it, and
  // the service is only confirming.
  const selected = pending ?? chosen;
  const error = result === undefined ? undefined : chooseError(result);
  return {
    options: AVATAR_MODELS.map((model) => ({
      model,
      name: STUDIES[model].name,
      detail: STUDIES[model].detail,
      selected: model === selected,
    })),
    rendered: selected ?? DEFAULT_AVATAR_MODEL,
    unchosen: selected === undefined,
    busy: pending !== undefined,
    ...(error === undefined ? {} : { error }),
  };
}
