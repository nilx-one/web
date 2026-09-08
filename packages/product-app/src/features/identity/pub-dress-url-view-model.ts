// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  PUB_DRESS_URL_ZONE,
  formatPubDress,
  formatPubDressUrl,
  projectCorePubDressLabel,
  projectCorePubDressLabelComposition,
  type CorePubDressLabelResult,
  type PubDressLabelRejection,
  type PubDressLabelResolutionResult,
  type PubDressSelection,
} from "@nilx-one/application";

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
      ascii?: string;
      folded: boolean;
      url?: string;
      status: PubDressUrlStatus;
      detail: string;
    }
  | {
      kind: "suffix";
      pubDress: string;
      stem: string;
      ascii?: string;
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

function verifiedDetail(folded: boolean, encoded: boolean): string {
  if (folded) {
    return "Core maps this ASCII address to its canonical lowercase label";
  }
  if (encoded) {
    return "DNS encoding verified by 0x1 Core";
  }
  return "Address verified by 0x1 Core";
}

function rejectionDetail(reason: PubDressLabelRejection): string {
  switch (reason) {
    case "disallowed-scalar":
      return "No address — this scalar is not allowed by the Core address contract";
    case "bidi-rule":
      return "No address — a right-to-left script cannot follow the 0x prefix";
    case "not-encodable":
      return "No address — Core cannot encode this value as one DNS label";
    case "unsupported-character":
      return "No address — this character cannot appear in a DNS label";
    case "boundary-hyphen":
      return "No address — an address cannot end on a hyphen";
    case "too-long":
      return "No address — this is too long for one DNS label";
    case "not-a-pub-dress":
      return "No address — finish a canonical pub_dress first";
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

function statusDetail(
  status: PubDressUrlStatus,
  folded: boolean,
  encoded: boolean,
  suffixed: boolean,
): string {
  switch (status) {
    case "checking":
      return "Checking this address…";
    case "available":
      return suffixed
        ? "This address is free"
        : verifiedDetail(folded, encoded);
    case "taken":
      return "Another Bond holds this address — add a distinguishing part";
    case "invalid":
      return "That part cannot appear in an address";
    case "unresolved":
      return verifiedDetail(folded, encoded);
    case "service-unavailable":
      return "Unavailable — couldn’t verify this address";
  }
}

export interface PubDressUrlInput {
  readonly selection: PubDressSelection;
  readonly suffix: string;
  readonly pending: boolean;
  readonly resolution: PubDressLabelResolutionResult | undefined;
  /** Normative derivation returned by the Core runtime. */
  readonly derivation?: CorePubDressLabelResult | undefined;
  readonly derivationPending?: boolean;
  /** Normative suffix composition returned by Core when the suffix UI is active. */
  readonly composition?: CorePubDressLabelResult | undefined;
  readonly compositionPending?: boolean;
}

export function createPubDressUrlViewState({
  selection,
  suffix,
  pending,
  resolution,
  derivation,
  derivationPending = false,
  composition,
  compositionPending = false,
}: PubDressUrlInput): PubDressUrlViewState {
  if ([...selection.slug].length < 2) {
    return { kind: "idle" };
  }

  const pubDress = formatPubDress(selection);
  if (derivation === undefined) {
    return {
      kind: "preview",
      pubDress,
      stem: pubDress,
      folded: false,
      status: derivationPending ? "checking" : "service-unavailable",
      detail: derivationPending
        ? "Deriving this address with 0x1 Core…"
        : "Unavailable — 0x1 Core did not provide an address",
    };
  }

  const derived = projectCorePubDressLabel(pubDress, derivation);
  if (derived.kind === "unrepresentable") {
    return {
      kind: "unrepresentable",
      pubDress,
      reason: derived.reason,
      detail: rejectionDetail(derived.reason),
    };
  }

  const status = resolutionStatus(pending, resolution);
  const encoded = derived.ascii !== derived.stem;

  // A collision opens the suffix control before the Bond has typed anything.
  // Core composition is only required once there is a suffix to compose; an
  // empty editor is a real "taken" state, not a Core service failure.
  if (status === "taken" && suffix.length === 0) {
    return {
      kind: "suffix",
      pubDress,
      stem: derived.stem,
      ...(encoded ? { ascii: derived.ascii } : {}),
      folded: derived.folded,
      suffix,
      status,
      detail: statusDetail(status, derived.folded, encoded, false),
    };
  }

  if (suffix.length > 0) {
    if (composition === undefined) {
      return {
        kind: "suffix",
        pubDress,
        stem: derived.stem,
        ...(encoded ? { ascii: derived.ascii } : {}),
        folded: derived.folded,
        suffix,
        status: compositionPending ? "checking" : "service-unavailable",
        detail: compositionPending
          ? "Checking this distinguishing part with 0x1 Core…"
          : "Unavailable — 0x1 Core did not compose this address",
      };
    }

    const projected = projectCorePubDressLabelComposition(
      pubDress,
      suffix,
      composition,
    );
    if (projected.kind === "rejected") {
      return {
        kind: "suffix",
        pubDress,
        stem: derived.stem,
        ...(encoded ? { ascii: derived.ascii } : {}),
        folded: derived.folded,
        suffix,
        status: "invalid",
        detail: rejectionDetail(projected.reason),
      };
    }

    return {
      kind: "suffix",
      pubDress,
      stem: derived.stem,
      ...(projected.ascii === projected.label
        ? {}
        : { ascii: projected.ascii }),
      folded: derived.folded,
      suffix,
      url: projected.url,
      status,
      detail: statusDetail(status, derived.folded, encoded, true),
    };
  }

  return {
    kind: "preview",
    pubDress,
    stem: derived.stem,
    folded: derived.folded,
    url: formatPubDressUrl(derived.stem),
    ...(encoded ? { ascii: derived.ascii } : {}),
    status,
    detail: statusDetail(status, derived.folded, encoded, false),
  };
}
