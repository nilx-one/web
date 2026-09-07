// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CorePubDressLabelErrorCode,
  CorePubDressLabelResult,
} from "./core-runtime";

export const PUB_DRESS_URL_ZONE = "nilx.one";

/** RFC 1035 label limit. Enforcement belongs to Core; exported for UI copy. */
export const PUB_DRESS_LABEL_MAX_LENGTH = 63;

export const PUB_DRESS_URL_SUFFIX_MAX_LENGTH = 8;

export type PubDressLabelRejection =
  | "not-a-pub-dress"
  | "unsupported-character"
  | "disallowed-scalar"
  | "bidi-rule"
  | "not-encodable"
  | "boundary-hyphen"
  | "too-long";

export interface PubDressLabelStem {
  kind: "stem";
  /** Human-readable form shown by the product. */
  stem: string;
  /** Core-owned ASCII A-label carried by DNS. */
  ascii: string;
  /** Exact identity source; never normalized by Web. */
  source: string;
  /** True only when an ASCII identity visibly folds to another ASCII label. */
  folded: boolean;
}

export type PubDressLabelDerivation =
  | PubDressLabelStem
  | { kind: "unrepresentable"; reason: PubDressLabelRejection };

export type PubDressLabelComposition =
  | { kind: "label"; label: string; ascii: string; url: string }
  | { kind: "rejected"; reason: PubDressLabelRejection };

function rejectionFromCore(
  code: CorePubDressLabelErrorCode,
): PubDressLabelRejection {
  switch (code) {
    case "not_a_pub_dress":
      return "not-a-pub-dress";
    case "invalid_character":
      return "unsupported-character";
    case "disallowed_scalar":
      return "disallowed-scalar";
    case "bidi_rule":
      return "bidi-rule";
    case "not_encodable":
      return "not-encodable";
    case "boundary_hyphen":
      return "boundary-hyphen";
    case "too_long":
    case "suffix_too_long":
      return "too-long";
  }
}

function isAscii(value: string): boolean {
  return [...value].every((scalar) => (scalar.codePointAt(0) ?? 0) < 0x80);
}

/**
 * Converts a Core label result into product presentation.
 *
 * This function performs no IDNA mapping. The `ascii` value is already the
 * normative A-label returned by Core. For an ACE label Web keeps the exact
 * `PubDress` as the readable form and shows the A-label beside it. For an ASCII
 * label the Core output itself is the readable form, making an ASCII case fold
 * visible without Web reproducing the fold.
 */
export function projectCorePubDressLabel(
  pubDress: string,
  result: CorePubDressLabelResult,
): PubDressLabelDerivation {
  if (result.kind === "error") {
    return {
      kind: "unrepresentable",
      reason: rejectionFromCore(result.code),
    };
  }

  const ace = result.label.startsWith("xn--");
  const stem = ace ? pubDress : result.label;

  return {
    kind: "stem",
    stem,
    ascii: result.label,
    source: pubDress,
    folded: isAscii(pubDress) && result.label !== pubDress,
  };
}

/**
 * Presents a Core-composed label. Composition and UTS-46 happen in Core; Web
 * only chooses which equivalent human-readable form to display.
 */
export function projectCorePubDressLabelComposition(
  pubDress: string,
  suffix: string,
  result: CorePubDressLabelResult,
  zone: string = PUB_DRESS_URL_ZONE,
): PubDressLabelComposition {
  if (result.kind === "error") {
    return {
      kind: "rejected",
      reason: rejectionFromCore(result.code),
    };
  }

  const source = `${pubDress}${suffix}`;
  const label = result.label.startsWith("xn--") ? source : result.label;

  return {
    kind: "label",
    label,
    ascii: result.label,
    url: formatPubDressUrl(label, zone),
  };
}

/** ASCII-only normalization for the user-selected disambiguation suffix. */
export function normalizePubDressUrlSuffix(suffix: string): string {
  let folded = "";
  for (const scalar of suffix.trim()) {
    const code = scalar.codePointAt(0) ?? 0;
    folded +=
      code >= 0x41 && code <= 0x5a ? String.fromCodePoint(code + 0x20) : scalar;
  }
  return folded;
}

export function formatPubDressUrl(
  label: string,
  zone: string = PUB_DRESS_URL_ZONE,
): string {
  return `https://${label}.${zone}`;
}

/**
 * Proposes a decimal collision suffix. Availability and allocation remain
 * server facts; this helper only produces editable presentation input.
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
