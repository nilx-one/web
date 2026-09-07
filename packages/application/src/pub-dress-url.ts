// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { parsePubDress } from "./identity-registration";

/**
 * A `pub_dress` is case-sensitive; a DNS label is not. The public address of a
 * Bond therefore cannot be the identity itself — it is a derived, separately
 * unique projection of it.
 *
 * Two consequences drive this whole module:
 *
 * - the derivation is deliberately *not* injective (`0x0Sky` and `0x0sky` fold
 *   onto one label), so a label can never be resolved back to a `pub_dress` by
 *   computation, only by lookup;
 * - the first Bond to claim a label owns it, and every later Bond folding onto
 *   the same label chooses a distinguishing suffix instead.
 *
 * The client derives and previews. Allocation stays a server transaction, in
 * the same way `resolvePubDress` is advisory while the insert is the only
 * collision boundary.
 *
 * A label has two forms and both matter. The Bond reads the Unicode form —
 * `0x0небо.nilx.one` is what a browser shows in its address bar — while DNS
 * carries the ASCII form, `xn--0x0-dddt1cj`. This module returns both.
 */

export const PUB_DRESS_URL_ZONE = "nilx.one";

/** RFC 1035 label limit, counted in octets of the ASCII form. */
export const PUB_DRESS_LABEL_MAX_LENGTH = 63;

export const PUB_DRESS_URL_SUFFIX_MAX_LENGTH = 8;

export type PubDressLabelRejection =
  /** The input was not a canonical `pub_dress`. */
  | "not-a-pub-dress"
  /** ASCII outside the letter-digit-hyphen set a DNS label may carry. */
  | "unsupported-character"
  /**
   * A non-ASCII scalar that is not a letter, mark, or digit — an emoji or a
   * symbol. Punycode would encode it happily; IDNA does not allow it.
   */
  | "disallowed-scalar"
  /**
   * RFC 5893 requires a right-to-left label to begin with a strongly typed
   * letter, and every label here begins with the digit `0`. Hebrew and Arabic
   * identities are excluded by the `0x` prefix, not by their script.
   */
  | "bidi-rule"
  | "boundary-hyphen"
  | "too-long";

export interface PubDressLabelStem {
  kind: "stem";
  /** The Unicode form, which is what the Bond reads. */
  stem: string;
  /** The ASCII form DNS carries. Equal to `stem` for an ASCII identity. */
  ascii: string;
  /** True when folding changed the address the Bond typed. */
  folded: boolean;
}

export type PubDressLabelDerivation =
  | PubDressLabelStem
  | { kind: "unrepresentable"; reason: PubDressLabelRejection };

export type PubDressLabelComposition =
  | { kind: "label"; label: string; ascii: string; url: string }
  | { kind: "rejected"; reason: PubDressLabelRejection };

/**
 * Case folding across every script, so `0x0Небо` and `0x0небо` land on one
 * label exactly as their ASCII counterparts do. Lowercasing can denormalize,
 * so the result is normalized again rather than once.
 */
function fold(value: string): string {
  return value.normalize("NFC").toLowerCase().normalize("NFC");
}

function rejectLabelText(value: string): PubDressLabelRejection | undefined {
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    if (code > 0x7f) {
      // Conservative stand-in for the UTS-46 validity table, which this package
      // does not carry. It may refuse a scalar the contract would accept, which
      // costs a preview; it never accepts one the contract refuses, which would
      // promise an address that registration then denies.
      if (!/[\p{L}\p{M}\p{Nd}]/u.test(scalar)) {
        return "disallowed-scalar";
      }
      continue;
    }
    if (!/^[a-z0-9-]$/.test(scalar)) {
      return "unsupported-character";
    }
  }
  if (value.startsWith("-") || value.endsWith("-")) {
    return "boundary-hyphen";
  }
  return undefined;
}

/**
 * Encodes a Unicode label to its ASCII form using the platform's own UTS-46,
 * reached through URL parsing because that is the one conformant
 * implementation available without a dependency.
 *
 * This is a preview, not the normative encoder. The platform's UTS-46 revision
 * can differ from the one `nilx-one/core` pins, and URL parsing deliberately
 * relaxes some checks, which is why the charset and length rules above and
 * below are applied separately rather than trusted to it.
 */
function encodeLabel(label: string, zone: string): string | undefined {
  try {
    const { hostname } = new URL(`https://${label}.${zone}`);
    const suffix = `.${zone}`;
    return hostname.endsWith(suffix)
      ? hostname.slice(0, -suffix.length)
      : undefined;
  } catch {
    // The charset is already validated, so the remaining refusal the URL parser
    // makes here is the Bidi rule.
    return undefined;
  }
}

function finish(
  label: string,
  zone: string,
): { ascii: string } | { reason: PubDressLabelRejection } {
  const rejection = rejectLabelText(label);
  if (rejection !== undefined) {
    return { reason: rejection };
  }
  const ascii = encodeLabel(label, zone);
  if (ascii === undefined) {
    return { reason: "bidi-rule" };
  }
  // Measured on the ASCII form: a 32-scalar slug is a valid pub_dress and can
  // still encode past the limit.
  if (ascii.length > PUB_DRESS_LABEL_MAX_LENGTH) {
    return { reason: "too-long" };
  }
  return { ascii };
}

/**
 * Folds a canonical `pub_dress` onto the fixed first part of its public label.
 *
 * Every ASCII stem keeps the `0x` prefix and every encoded one begins `xn--`,
 * which is what keeps the Bond namespace disjoint from service hosts: no Bond
 * can fold onto `www`, `api`, or `_acme-challenge`, so no blocklist has to be
 * maintained for them. An ASCII stem can never begin `xn--` either, so an ACE
 * prefix cannot be forged.
 */
export function derivePubDressLabelStem(
  pubDress: string,
  zone: string = PUB_DRESS_URL_ZONE,
): PubDressLabelDerivation {
  if (parsePubDress(pubDress) === undefined) {
    return { kind: "unrepresentable", reason: "not-a-pub-dress" };
  }

  const stem = fold(pubDress);
  const outcome = finish(stem, zone);
  if ("reason" in outcome) {
    return { kind: "unrepresentable", reason: outcome.reason };
  }

  return {
    kind: "stem",
    stem,
    ascii: outcome.ascii,
    folded: stem !== pubDress.normalize("NFC"),
  };
}

/** Folds a Bond's typed suffix the same way the stem is folded. */
export function normalizePubDressUrlSuffix(suffix: string): string {
  return fold(suffix.trim());
}

/**
 * Joins the fixed stem with the Bond's chosen suffix.
 *
 * Composition happens on the Unicode form and encodes once. Appending a suffix
 * to an already-encoded `xn--` label would produce a string that no longer
 * decodes.
 */
export function composePubDressLabel(
  stem: string,
  suffix = "",
  zone: string = PUB_DRESS_URL_ZONE,
): PubDressLabelComposition {
  const normalizedSuffix = normalizePubDressUrlSuffix(suffix);
  if (normalizedSuffix.length > PUB_DRESS_URL_SUFFIX_MAX_LENGTH) {
    return { kind: "rejected", reason: "too-long" };
  }

  const label = `${stem}${normalizedSuffix}`;
  const outcome = finish(label, zone);
  if ("reason" in outcome) {
    return { kind: "rejected", reason: outcome.reason };
  }

  return {
    kind: "label",
    label,
    ascii: outcome.ascii,
    url: formatPubDressUrl(label, zone),
  };
}

/** The address as the Bond reads it, which is the form a browser displays. */
export function formatPubDressUrl(
  label: string,
  zone: string = PUB_DRESS_URL_ZONE,
): string {
  return `https://${label}.${zone}`;
}

/**
 * Proposes a distinguishing suffix after a fold collision. Digits only: they
 * read as a disambiguator rather than as part of the chosen name, they stay
 * ASCII whatever the stem's script, and they cannot reintroduce a hyphen at a
 * label boundary.
 */
export function suggestPubDressUrlSuffix(
  random: () => number = Math.random,
  length = 4,
): string {
  let suffix = "";
  for (let index = 0; index < length; index += 1) {
    const draw = random();
    const digit = Math.min(9, Math.max(0, Math.floor(draw * 10)));
    suffix += String(digit);
  }
  return suffix;
}
