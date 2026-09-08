// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PubDressRenameResult } from "@nilx-one/application";

/** The canonical slug bounds, in Unicode scalars rather than UTF-16 units. */
export const MIN_SLUG_SCALARS = 2;
export const MAX_SLUG_SCALARS = 32;

const PREFIX = "0x";

export interface PubDressParts {
  /** The lowercase hexadecimal discriminator the Bond registered under. */
  readonly discriminator: string;
  readonly slug: string;
}

/**
 * Splits a canonical address into the part the Bond keeps and the part it may
 * change. An address the service accepted always splits; anything else is
 * presented whole, with no slug to edit.
 */
export function pubDressParts(pubDress: string): PubDressParts | undefined {
  if (!pubDress.startsWith(PREFIX)) return undefined;
  const body = [...pubDress.slice(PREFIX.length)];
  const discriminator = body[0];
  if (discriminator === undefined || !/^[0-9a-f]$/.test(discriminator)) {
    return undefined;
  }
  return { discriminator, slug: body.slice(1).join("") };
}

export interface ProfileSlugViewState {
  readonly kind: "editable" | "fixed";
  readonly pubDress: string;
  readonly discriminator: string;
  /** The slug being edited, which is the current one until someone types. */
  readonly slug: string;
  /** The address the draft would produce, shown while it is still valid. */
  readonly preview: string;
  readonly busy: boolean;
  readonly canSave: boolean;
  readonly note: string;
  readonly error?: string;
  /** The address the last completed save produced, for confirmation. */
  readonly saved?: string;
}

function scalarCount(value: string): number {
  return [...value].length;
}

function renameError(result: PubDressRenameResult): string | undefined {
  if (result.kind === "service-unavailable")
    return "Couldn’t save this address. Try again.";
  if (result.kind !== "rejected") return undefined;
  switch (result.reason) {
    case "authentication-required":
      return "Sign in again to change this address.";
    case "unavailable":
      return "That address belongs to another Bond.";
    case "avaia-unavailable":
      return "The Avaia address this name derives is taken. Choose another.";
    case "invalid-length":
      return `Use ${MIN_SLUG_SCALARS}–${MAX_SLUG_SCALARS} characters.`;
    case "invalid-character":
      return "Remove characters an address can’t hold, like spaces.";
    case "rate-limited":
      return "Too many attempts. Wait before trying again.";
  }
}

/**
 * The one editable fact of a Bond profile. The discriminator, the provider
 * bindings and the owned Avaia are all consequences the service owns, so this
 * state carries exactly what a person may type and what happened when they did.
 */
export function createProfileSlugViewState(
  pubDress: string,
  draft: string | undefined,
  pending: boolean,
  result?: PubDressRenameResult,
): ProfileSlugViewState {
  const parts = pubDressParts(pubDress);
  if (parts === undefined) {
    return {
      kind: "fixed",
      pubDress,
      discriminator: "",
      slug: "",
      preview: pubDress,
      busy: false,
      canSave: false,
      note: "This address cannot be edited on this host.",
    };
  }

  const slug = draft ?? parts.slug;
  const length = scalarCount(slug);
  const withinBounds = length >= MIN_SLUG_SCALARS && length <= MAX_SLUG_SCALARS;
  const changed = slug !== parts.slug;
  const error = result === undefined ? undefined : renameError(result);
  // A save is confirmed only once the surface already shows the address the
  // service returned, so the confirmation can never describe a stale draft.
  const saved =
    result?.kind === "renamed" && result.identity.pubDress === pubDress
      ? pubDress
      : undefined;

  return {
    kind: "editable",
    pubDress,
    discriminator: parts.discriminator,
    slug,
    preview: `${PREFIX}${parts.discriminator}${slug}`,
    busy: pending,
    canSave: changed && withinBounds && !pending,
    note: `Case-sensitive · ${MIN_SLUG_SCALARS}–${MAX_SLUG_SCALARS} characters · the discriminator stays ${parts.discriminator}`,
    ...(changed && !withinBounds
      ? { error: `Use ${MIN_SLUG_SCALARS}–${MAX_SLUG_SCALARS} characters.` }
      : error === undefined
        ? {}
        : { error }),
    ...(saved === undefined ? {} : { saved }),
  };
}
