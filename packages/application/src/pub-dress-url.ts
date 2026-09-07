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
 */

export const PUB_DRESS_URL_ZONE = "nilx.one";

/** RFC 1035 label limit, counted in octets of the ASCII label. */
export const PUB_DRESS_LABEL_MAX_LENGTH = 63;

export const PUB_DRESS_URL_SUFFIX_MAX_LENGTH = 8;

export type PubDressLabelRejection =
  /** The input was not a canonical `pub_dress`. */
  | "not-a-pub-dress"
  /**
   * Such an identity does get an address: the contract encodes it with UTS-46
   * (`0x0небо` becomes `xn--0x0-dddt1cj`). This preview cannot compute that
   * without a second IDNA implementation, which is exactly the drift the
   * contract exists to prevent, so it declines to guess and says so.
   *
   * See docs/pub-dress-label.contract.yaml.
   */
  | "non-ascii"
  | "unsupported-character"
  | "boundary-hyphen"
  | "too-long";

export type PubDressLabelStem =
  | {
      kind: "stem";
      stem: string;
      /** True when case folding changed the address the Bond typed. */
      folded: boolean;
    }
  | { kind: "unrepresentable"; reason: PubDressLabelRejection };

export type PubDressLabelComposition =
  | { kind: "label"; label: string; url: string }
  | { kind: "rejected"; reason: PubDressLabelRejection };

/** ASCII-only fold. `String.prototype.toLowerCase` also folds scalars this
 *  module refuses, which would hide a rejection behind a silent rewrite. */
function foldAscii(value: string): string {
  let folded = "";
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    folded +=
      code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : scalar;
  }
  return folded;
}

function rejectLabelText(value: string): PubDressLabelRejection | undefined {
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    if (code > 0x7f) {
      return "non-ascii";
    }
    if (!/^[a-z0-9-]$/.test(scalar)) {
      return "unsupported-character";
    }
  }
  if (value.startsWith("-") || value.endsWith("-")) {
    return "boundary-hyphen";
  }
  if (value.length > PUB_DRESS_LABEL_MAX_LENGTH) {
    return "too-long";
  }
  return undefined;
}

/**
 * Folds a canonical `pub_dress` onto the fixed first part of its public label.
 *
 * Every stem keeps the `0x` prefix, which is what keeps the user namespace
 * disjoint from service hosts: no Bond can ever fold onto `www`, `api`, or
 * `_acme-challenge`, so no blocklist has to be maintained for them.
 */
export function derivePubDressLabelStem(pubDress: string): PubDressLabelStem {
  if (parsePubDress(pubDress) === undefined) {
    return { kind: "unrepresentable", reason: "not-a-pub-dress" };
  }

  const stem = foldAscii(pubDress);
  const rejection = rejectLabelText(stem);
  if (rejection !== undefined) {
    return { kind: "unrepresentable", reason: rejection };
  }

  return { kind: "stem", stem, folded: stem !== pubDress };
}

/** Folds a Bond's typed suffix the same way the stem is folded. */
export function normalizePubDressUrlSuffix(suffix: string): string {
  return foldAscii(suffix.trim());
}

/**
 * Joins the fixed stem with the Bond's chosen suffix. The suffix is validated
 * as part of the whole label so a trailing hyphen is caught wherever it came
 * from.
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
  const rejection = rejectLabelText(label);
  if (rejection !== undefined) {
    return { kind: "rejected", reason: rejection };
  }

  return { kind: "label", label, url: formatPubDressUrl(label, zone) };
}

export function formatPubDressUrl(
  label: string,
  zone: string = PUB_DRESS_URL_ZONE,
): string {
  return `https://${label}.${zone}`;
}

/**
 * Proposes a distinguishing suffix after a fold collision. Digits only: they
 * read as a disambiguator rather than as part of the chosen name, and they
 * cannot reintroduce a hyphen at a label boundary.
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
