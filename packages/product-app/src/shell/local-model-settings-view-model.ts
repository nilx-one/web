// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What this Settings fieldset shows about the on-device model, and what an owner may do
 * about it from here.
 *
 * This is a status and management surface, not the trigger that first loads a model: per
 * `nilx-one/ai#8`, a model is only ever lazy-loaded from explicit product entry — the
 * moment a feature that needs it is opened. What belongs in Settings is the part that entry
 * point cannot honestly cover on its own: whether the artifacts are already on this device,
 * how large a first download would be and where it would come from, and a way to reclaim
 * the storage without waiting for eviction to do it. A "download now" here is a convenience
 * prefetch — the same bytes that entry point would ask for, asked for early.
 */

export type UnsupportedReason =
  | "insecure_context"
  | "webgpu_missing"
  | "adapter_unavailable"
  | "below_runtime_floor"
  | "missing_features";

export type LocalModelPhase =
  | { readonly kind: "checking" }
  | { readonly kind: "unsupported"; readonly reason: UnsupportedReason }
  | {
      readonly kind: "absent";
      readonly bytes: number | null;
      readonly source: "mirror" | "upstream";
    }
  | {
      readonly kind: "downloading";
      readonly ratio: number;
      readonly text: string;
    }
  | { readonly kind: "present" }
  | { readonly kind: "removing" }
  | { readonly kind: "error"; readonly message: string };

export type LocalModelStatusKey =
  | "checking"
  | "unsupportedInsecure"
  | "unsupportedNoWebgpu"
  | "unsupportedNoAdapter"
  | "unsupportedBelowFloor"
  | "unsupportedFeatures"
  | "absent"
  | "downloading"
  | "present"
  | "removing"
  | "error";

export interface LocalModelSettingsViewState {
  readonly statusKey: LocalModelStatusKey;
  readonly detailBytes?: number;
  readonly detailSource?: "mirror" | "upstream";
  readonly progressRatio?: number;
  /** WebLLM's own init text. Rendered as-is: it is not a catalog this product owns. */
  readonly progressText?: string;
  readonly errorMessage?: string;
  readonly notices: readonly string[];
  readonly canDownload: boolean;
  readonly canRemove: boolean;
  /** Only a download is worth abandoning midway; removal is quick and local. */
  readonly canCancel: boolean;
  readonly busy: boolean;
}

function unsupportedStatusKey(reason: UnsupportedReason): LocalModelStatusKey {
  switch (reason) {
    case "insecure_context":
      return "unsupportedInsecure";
    case "webgpu_missing":
      return "unsupportedNoWebgpu";
    case "adapter_unavailable":
      return "unsupportedNoAdapter";
    case "below_runtime_floor":
      return "unsupportedBelowFloor";
    case "missing_features":
      return "unsupportedFeatures";
  }
}

function statusKeyFor(phase: LocalModelPhase): LocalModelStatusKey {
  switch (phase.kind) {
    case "unsupported":
      return unsupportedStatusKey(phase.reason);
    case "checking":
    case "absent":
    case "downloading":
    case "present":
    case "removing":
    case "error":
      return phase.kind;
  }
}

export function createLocalModelSettingsViewState(
  phase: LocalModelPhase,
  notices: readonly string[] = [],
): LocalModelSettingsViewState {
  return {
    statusKey: statusKeyFor(phase),
    ...(phase.kind === "absent"
      ? {
          ...(phase.bytes === null ? {} : { detailBytes: phase.bytes }),
          detailSource: phase.source,
        }
      : {}),
    ...(phase.kind === "downloading"
      ? { progressRatio: phase.ratio, progressText: phase.text }
      : {}),
    ...(phase.kind === "error" ? { errorMessage: phase.message } : {}),
    notices: phase.kind === "absent" ? notices : [],
    canDownload: phase.kind === "absent" || phase.kind === "error",
    canRemove: phase.kind === "present",
    canCancel: phase.kind === "downloading",
    busy: phase.kind === "downloading" || phase.kind === "removing",
  };
}
