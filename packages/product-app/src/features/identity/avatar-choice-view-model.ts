// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  AVATAR_MODELS,
  type AvatarModel,
  type AvatarModelResult,
  type StoredAvatarModel,
} from "@nilx-one/application";

/**
 * The body a Bond is represented by. A stored model may be newer than this
 * client; that explicit choice remains distinct from an identity that chose
 * nothing, and only a model this client publishes may reach the renderer.
 */
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
  /** The model the world may draw right now. Absent until a supported choice exists. */
  readonly rendered?: AvatarModel;
  /** True only while no choice has been recorded for this Bond. */
  readonly unchosen: boolean;
  /** A stored model id this client cannot render without a newer contract. */
  readonly unsupportedModel?: string;
  readonly busy: boolean;
  readonly error?: string;
}

const STUDIES: Readonly<
  Record<AvatarModel, { name: string; detail: string }>
> = {
  "sky-study": { name: "Sky", detail: "masculine study" },
  "dasha-study": { name: "Dasha", detail: "feminine study" },
  "kai-study": { name: "Kai", detail: "non-binary study" },
};

function isPublishedAvatarModel(
  model: StoredAvatarModel,
): model is AvatarModel {
  return (AVATAR_MODELS as readonly string[]).includes(model);
}

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
  chosen: StoredAvatarModel | undefined,
  pending: AvatarModel | undefined,
  result?: AvatarModelResult,
): AvatarChoiceViewState {
  // An in-flight choice is shown as selected: the person already made it, and
  // the service is only confirming. A future model id is kept explicit but is
  // never cast into a body this client knows how to draw.
  const candidate = pending ?? chosen;
  const rendered =
    candidate !== undefined && isPublishedAvatarModel(candidate)
      ? candidate
      : undefined;
  const unsupportedModel =
    candidate !== undefined && !isPublishedAvatarModel(candidate)
      ? candidate
      : undefined;
  const error = result === undefined ? undefined : chooseError(result);
  return {
    options: AVATAR_MODELS.map((model) => ({
      model,
      name: STUDIES[model].name,
      detail: STUDIES[model].detail,
      selected: model === rendered,
    })),
    ...(rendered === undefined ? {} : { rendered }),
    unchosen: candidate === undefined,
    ...(unsupportedModel === undefined ? {} : { unsupportedModel }),
    busy: pending !== undefined,
    ...(error === undefined ? {} : { error }),
  };
}
