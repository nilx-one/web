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
  /**
   * The encoder refused for some other reason. Named separately because the
   * Bidi rule is not the only refusal: Khmer U+17B4 and the Hangul fillers pass
   * the scalar test above and still cannot form a label, and telling those
   * Bonds their script reads right to left would simply be false.
   */
  | "not-encodable"
  | "boundary-hyphen"
  | "too-long";

export interface PubDressLabelStem {
  kind: "stem";
  /** The form the Bond reads, which is what a browser shows. */
  stem: string;
  /** The form DNS carries. Equal to `stem` for an ASCII identity. */
  ascii: string;
  /**
   * The material a suffix is appended to. Always the identity as typed, so the
   * encoder performs the whole mapping in one pass: folding first and encoding
   * second would let this module's approximation of UTS-46 decide the address.
   */
  source: string;
  /** True when the address the Bond reads differs from the address it typed. */
  folded: boolean;
}

export type PubDressLabelDerivation =
  | PubDressLabelStem
  | { kind: "unrepresentable"; reason: PubDressLabelRejection };

export type PubDressLabelComposition =
  | { kind: "label"; label: string; ascii: string; url: string }
  | { kind: "rejected"; reason: PubDressLabelRejection };

/**
 * Scripts whose labels the Bidi rule governs. Used only to tell a Bond why its
 * address was refused; the refusal itself comes from the encoder.
 */
const RIGHT_TO_LEFT =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u07C0-\u07FF\u0800-\u085F\u08A0-\u08FF\uFB1D-\uFB4F\uFB50-\uFDFF\uFE70-\uFEFF]/u;

/** ASCII-only fold, for material that must stay ASCII whatever the stem is. */
function foldAscii(value: string): string {
  let folded = "";
  for (const scalar of value) {
    const code = scalar.codePointAt(0) ?? 0;
    folded +=
      code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : scalar;
  }
  return folded;
}

function isAscii(value: string): boolean {
  return [...value].every((scalar) => (scalar.codePointAt(0) ?? 0) < 0x80);
}

function rejectScalars(value: string): PubDressLabelRejection | undefined {
  for (const scalar of value) {
    if ((scalar.codePointAt(0) ?? 0) > 0x7f) {
      // Conservative stand-in for the UTS-46 validity table, which this package
      // does not carry. It may refuse a scalar the contract would accept, which
      // costs a preview; it never accepts one the contract refuses, which would
      // promise an address that registration then denies.
      if (!/[\p{L}\p{M}\p{Nd}]/u.test(scalar)) {
        return "disallowed-scalar";
      }
      continue;
    }
    if (!/^[a-zA-Z0-9-]$/.test(scalar)) {
      return "unsupported-character";
    }
  }
  // URL parsing relaxes CheckHyphens, so the boundary rule is applied here.
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
 * relaxes some checks, which is why the scalar, boundary and length rules
 * around it are applied separately rather than trusted to it.
 */
function encodeLabel(label: string, zone: string): string | undefined {
  const suffix = `.${zone.toLowerCase()}`;
  let hostname: string;
  try {
    ({ hostname } = new URL(`https://${label}.${zone}`));
  } catch {
    return undefined;
  }
  if (!hostname.endsWith(suffix)) {
    return undefined;
  }
  const encoded = hostname.slice(0, -suffix.length);
  // A runtime whose URL parser skips IDNA would hand back Unicode here, which
  // would silently turn the octet limit below into a UTF-16 character count.
  return /^[a-z0-9-]+$/.test(encoded) ? encoded : undefined;
}

/** Every Bond label begins `0x`, so this prefix only ever marks an A-label. */
const ACE_PREFIX = "xn--";

interface LabelForms {
  ascii: string;
  display: string;
}

/**
 * Both forms of one label.
 *
 * The ASCII form is authoritative: it is what DNS carries and what decides
 * whether two identities collide. The readable form is offered only when it
 * encodes back to exactly that ASCII form — otherwise this module's fold and
 * UTS-46's disagree (word-final sigma is the plain case: `toLowerCase` gives
 * `ς` where UTS-46 gives `σ`, which are different addresses) and the Bond is
 * shown the address it will actually get rather than a plausible wrong one.
 */
function labelForms(source: string, zone: string): LabelForms | undefined {
  const ascii = encodeLabel(source, zone);
  if (ascii === undefined) {
    return undefined;
  }
  if (!ascii.startsWith(ACE_PREFIX)) {
    // No ACE prefix means the encoder resolved the label to plain ASCII, having
    // already applied every mapping — including the compatibility ones this
    // module cannot reproduce, which is how fullwidth input reaches the same
    // label as its ASCII twin. Its output is therefore the readable form.
    return { ascii, display: ascii };
  }
  const readable = source.normalize("NFC").toLowerCase().normalize("NFC");
  return encodeLabel(readable, zone) === ascii
    ? { ascii, display: readable }
    : { ascii, display: ascii };
}

function refusal(source: string): PubDressLabelRejection {
  return RIGHT_TO_LEFT.test(source) ? "bidi-rule" : "not-encodable";
}

/**
 * Folds a canonical `pub_dress` onto the fixed first part of its public label.
 *
 * Every ASCII label keeps the `0x` prefix and every encoded one begins `xn--`,
 * which is what keeps the Bond namespace disjoint from service hosts: no Bond
 * can fold onto `www`, `api`, or `_acme-challenge`, so no blocklist has to be
 * maintained for them. An ASCII label can never begin `xn--` either, so an ACE
 * prefix cannot be forged.
 */
export function derivePubDressLabelStem(
  pubDress: string,
  zone: string = PUB_DRESS_URL_ZONE,
): PubDressLabelDerivation {
  if (parsePubDress(pubDress) === undefined) {
    return { kind: "unrepresentable", reason: "not-a-pub-dress" };
  }

  const source = pubDress.normalize("NFC");
  const rejection = rejectScalars(source);
  if (rejection !== undefined) {
    return { kind: "unrepresentable", reason: rejection };
  }

  const forms = labelForms(source, zone);
  if (forms === undefined) {
    return { kind: "unrepresentable", reason: refusal(source) };
  }
  // Measured on the ASCII form: a 32-scalar slug is a valid pub_dress and can
  // still encode past the limit.
  if (forms.ascii.length > PUB_DRESS_LABEL_MAX_LENGTH) {
    return { kind: "unrepresentable", reason: "too-long" };
  }

  return {
    kind: "stem",
    stem: forms.display,
    ascii: forms.ascii,
    source,
    folded: forms.display !== source,
  };
}

/**
 * Folds a Bond's typed suffix. ASCII only, whatever the stem's script: the
 * suffix is a disambiguator rather than part of the chosen name, and keeping it
 * ASCII means it can never change how the stem encodes.
 */
export function normalizePubDressUrlSuffix(suffix: string): string {
  return foldAscii(suffix.trim());
}

/**
 * Joins the identity with the Bond's chosen suffix.
 *
 * Composition happens on the identity as typed and encodes once. Appending a
 * suffix to an already-encoded `xn--` label would produce a string that no
 * longer decodes, and folding before encoding would let this module's
 * approximation of UTS-46 decide the address.
 */
export function composePubDressLabel(
  source: string,
  suffix = "",
  zone: string = PUB_DRESS_URL_ZONE,
): PubDressLabelComposition {
  const normalizedSuffix = normalizePubDressUrlSuffix(suffix);
  if (!isAscii(normalizedSuffix)) {
    return { kind: "rejected", reason: "unsupported-character" };
  }
  if (normalizedSuffix.length > PUB_DRESS_URL_SUFFIX_MAX_LENGTH) {
    return { kind: "rejected", reason: "too-long" };
  }

  const composed = `${source}${normalizedSuffix}`;
  const rejection = rejectScalars(composed);
  if (rejection !== undefined) {
    return { kind: "rejected", reason: rejection };
  }

  const forms = labelForms(composed, zone);
  if (forms === undefined) {
    return { kind: "rejected", reason: refusal(composed) };
  }
  if (forms.ascii.length > PUB_DRESS_LABEL_MAX_LENGTH) {
    return { kind: "rejected", reason: "too-long" };
  }

  return {
    kind: "label",
    label: forms.display,
    ascii: forms.ascii,
    url: formatPubDressUrl(forms.display, zone),
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
