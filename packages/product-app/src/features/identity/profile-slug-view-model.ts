// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PubDressRenameResult } from "@nilx-one/application";

/** The canonical slug bounds, in Unicode scalars rather than UTF-16 units. */
export const MIN_SLUG_SCALARS = 2;
export const MAX_SLUG_SCALARS = 32;

/**
 * An Avaia slug carries the mandatory `ai` suffix inside its own bounds, so it
 * may hold two scalars more than the human slug it is usually derived from.
 */
export const MAX_AVAIA_SLUG_SCALARS = 34;
export const AVAIA_SUFFIX = "ai";

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

/**
 * An owned Avaia address carries its owner's discriminator and no `0x` prefix,
 * so only the scalars after that discriminator are the Avaia's own name.
 */
export function avaiaPubDressParts(
  avaiaPubDress: string,
): PubDressParts | undefined {
  const body = [...avaiaPubDress];
  const discriminator = body[0];
  if (discriminator === undefined || !/^[0-9a-f]$/.test(discriminator)) {
    return undefined;
  }
  return { discriminator, slug: body.slice(1).join("") };
}

export interface AddressSlugViewState {
  readonly kind: "editable" | "fixed";
  /** What the address reads as today, before anything is typed. */
  readonly address: string;
  /** The immutable head the slug is written after: `0x0` or `0`. */
  readonly prefix: string;
  /** The slug being edited, which is the current one until someone types. */
  readonly slug: string;
  /** The address the draft would produce. */
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
      return "That Avaia address belongs to another identity.";
    case "invalid-length":
      return "That name is outside the length this address allows.";
    case "invalid-avaia-suffix":
      return `An Avaia name ends in ${AVAIA_SUFFIX}.`;
    case "invalid-character":
      return "Remove characters an address can’t hold, like spaces.";
    case "rate-limited":
      return "Too many attempts. Wait before trying again.";
  }
}

interface SlugRules {
  readonly maximum: number;
  readonly suffix?: string;
  readonly note: (prefix: string) => string;
}

function createSlugViewState(
  address: string | undefined,
  parts: PubDressParts | undefined,
  prefix: string,
  draft: string | undefined,
  pending: boolean,
  rules: SlugRules,
  result?: PubDressRenameResult,
): AddressSlugViewState {
  if (parts === undefined) {
    return {
      kind: "fixed",
      address: address ?? "",
      prefix: "",
      slug: "",
      preview: address ?? "",
      busy: false,
      canSave: false,
      note: "This address cannot be edited on this host.",
    };
  }

  const slug = draft ?? parts.slug;
  const length = scalarCount(slug);
  const withinBounds = length >= MIN_SLUG_SCALARS && length <= rules.maximum;
  const suffixed =
    rules.suffix === undefined ? true : slug.endsWith(rules.suffix);
  const changed = slug !== parts.slug;
  const local = !withinBounds
    ? `Use ${MIN_SLUG_SCALARS}–${rules.maximum} characters.`
    : suffixed
      ? undefined
      : `An Avaia name ends in ${rules.suffix}.`;
  const answered = result === undefined ? undefined : renameError(result);
  // A save is confirmed only once the surface already shows the address the
  // service returned, so the confirmation can never describe a stale draft.
  const saved =
    result?.kind === "renamed" &&
    (result.identity.avaiaPubDress === address ||
      result.identity.pubDress === address)
      ? address
      : undefined;

  return {
    kind: "editable",
    address: address ?? "",
    prefix,
    slug,
    preview: `${prefix}${slug}`,
    busy: pending,
    canSave: changed && withinBounds && suffixed && !pending,
    note: rules.note(prefix),
    ...(changed && local !== undefined
      ? { error: local }
      : answered === undefined
        ? {}
        : { error: answered }),
    ...(saved === undefined ? {} : { saved }),
  };
}

/**
 * The address a person answers to. The discriminator, the provider bindings
 * and the owned Avaia are consequences the service owns, so this state carries
 * exactly what a person may type and what happened when they did.
 */
export function createProfileSlugViewState(
  pubDress: string,
  draft: string | undefined,
  pending: boolean,
  result?: PubDressRenameResult,
): AddressSlugViewState {
  const parts = pubDressParts(pubDress);
  return createSlugViewState(
    pubDress,
    parts,
    parts === undefined ? "" : `${PREFIX}${parts.discriminator}`,
    draft,
    pending,
    {
      maximum: MAX_SLUG_SCALARS,
      note: () =>
        `Case-sensitive · ${MIN_SLUG_SCALARS}–${MAX_SLUG_SCALARS} characters`,
    },
    result,
  );
}

/**
 * The address of the Avaia this Bond owns. It inherits the owner's
 * discriminator and always ends in `ai`; the name between them is a choice,
 * even for a Bond whose Avaia has only ever been the derived default.
 */
export function createAvaiaSlugViewState(
  avaiaPubDress: string | undefined,
  ownerPubDress: string,
  draft: string | undefined,
  pending: boolean,
  result?: PubDressRenameResult,
): AddressSlugViewState {
  const owner = pubDressParts(ownerPubDress);
  const parts =
    avaiaPubDress === undefined
      ? owner === undefined
        ? undefined
        : { discriminator: owner.discriminator, slug: "" }
      : avaiaPubDressParts(avaiaPubDress);
  return createSlugViewState(
    avaiaPubDress,
    parts,
    parts?.discriminator ?? "",
    draft,
    pending,
    {
      maximum: MAX_AVAIA_SLUG_SCALARS,
      suffix: AVAIA_SUFFIX,
      note: () =>
        `Case-sensitive · ends in ${AVAIA_SUFFIX} · ${MIN_SLUG_SCALARS}–${MAX_AVAIA_SLUG_SCALARS} characters`,
    },
    result,
  );
}
