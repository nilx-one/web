// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  PUB_DRESS_URL_ZONE,
  composePubDressLabel,
  derivePubDressLabelStem,
  formatPubDress,
  type PubDressLabelRejection,
  type PubDressLabelResolutionResult,
  type PubDressSelection,
} from "@nilx-one/application";

/**
 * The public address surface has exactly two shapes.
 *
 * While the folded label is free, the Bond is shown one read-only line: the
 * address it typed, and the lowercase label that address becomes. The fold is
 * never silent — losing case is a fact about the identity's public URL, so the
 * Bond sees it before committing rather than discovering it afterwards.
 *
 * Once another Bond already holds that label, the same line splits: the folded
 * stem stays fixed, and a second part becomes editable in the same way the slug
 * is editable during registration.
 */
export type PubDressUrlViewState =
  | { kind: "idle" }
  | {
      kind: "unrepresentable";
      pubDress: string;
      reason: PubDressLabelRejection;
      detail: string;
    }
  | {
      kind: "preview";
      pubDress: string;
      stem: string;
      folded: boolean;
      url: string;
      status: PubDressUrlStatus;
      detail: string;
    }
  | {
      kind: "suffix";
      pubDress: string;
      stem: string;
      folded: boolean;
      suffix: string;
      url?: string;
      status: PubDressUrlStatus;
      detail: string;
    };

export type PubDressUrlStatus =
  | "checking"
  | "available"
  | "taken"
  | "invalid"
  | "unresolved"
  | "service-unavailable";

export const PUB_DRESS_URL_ZONE_LABEL = `.${PUB_DRESS_URL_ZONE}`;

function foldDetail(folded: boolean): string {
  return folded
    ? "Lowercased for the address — your pub_dress keeps its case"
    : "This address is already lowercase";
}

function rejectionDetail(reason: PubDressLabelRejection): string {
  switch (reason) {
    case "non-ascii":
      return "No address yet — this alphabet has no agreed address form";
    case "unsupported-character":
      return "No address — this character cannot appear in an address";
    case "boundary-hyphen":
      return "No address — an address cannot end on a hyphen";
    case "too-long":
      return "No address — this is too long for one address label";
    case "not-a-pub-dress":
      return "No address — finish the pub_dress first";
  }
}

function statusDetail(
  status: PubDressUrlStatus,
  folded: boolean,
  suffixed: boolean,
): string {
  switch (status) {
    case "checking":
      return "Checking this address…";
    case "available":
      return suffixed ? "This address is free" : foldDetail(folded);
    case "taken":
      return "Another Bond holds this address — add a distinguishing part";
    case "invalid":
      return "That part cannot appear in an address";
    case "unresolved":
      return foldDetail(folded);
    case "service-unavailable":
      return "Unavailable — couldn’t verify this address";
  }
}

function resolutionStatus(
  pending: boolean,
  resolution: PubDressLabelResolutionResult | undefined,
): PubDressUrlStatus {
  if (pending) {
    return "checking";
  }
  switch (resolution?.kind) {
    case "available":
      return "available";
    case "registered":
      return "taken";
    case "rejected":
      return "invalid";
    case "rate-limited":
    case "service-unavailable":
      return "service-unavailable";
    case undefined:
      return "unresolved";
  }
}

export interface PubDressUrlInput {
  readonly selection: PubDressSelection;
  /**
   * The part the Bond edits after a collision. An empty suffix keeps the
   * surface in its read-only preview shape.
   */
  readonly suffix: string;
  readonly pending: boolean;
  readonly resolution: PubDressLabelResolutionResult | undefined;
}

export function createPubDressUrlViewState({
  selection,
  suffix,
  pending,
  resolution,
}: PubDressUrlInput): PubDressUrlViewState {
  if ([...selection.slug].length < 2) {
    return { kind: "idle" };
  }

  const pubDress = formatPubDress(selection);
  const derived = derivePubDressLabelStem(pubDress);
  if (derived.kind === "unrepresentable") {
    return {
      kind: "unrepresentable",
      pubDress,
      reason: derived.reason,
      detail: rejectionDetail(derived.reason),
    };
  }

  const status = resolutionStatus(pending, resolution);
  const composition = composePubDressLabel(derived.stem, suffix);

  // A collision is what opens the editable part, but once it is open the Bond
  // keeps it: closing the field under them the moment their suffix resolves
  // would move focus out of the control they are typing in.
  if (status === "taken" || suffix.length > 0) {
    return {
      kind: "suffix",
      pubDress,
      stem: derived.stem,
      folded: derived.folded,
      suffix,
      ...(composition.kind === "label" ? { url: composition.url } : {}),
      status: composition.kind === "label" ? status : "invalid",
      detail:
        composition.kind === "label"
          ? statusDetail(status, derived.folded, suffix.length > 0)
          : rejectionDetail(composition.reason),
    };
  }

  return {
    kind: "preview",
    pubDress,
    stem: derived.stem,
    folded: derived.folded,
    url: composition.kind === "label" ? composition.url : "",
    status,
    detail: statusDetail(status, derived.folded, false),
  };
}
