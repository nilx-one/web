// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  LocalModelCatalogEntry,
  LocalModelDeviceVerdict,
} from "./local-model-host";

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
  | "missing_features"
  | "over_budget";

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
  | "unsupportedOverBudget"
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
    case "over_budget":
      return "unsupportedOverBudget";
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
    // An error may mean an interrupted download left something behind that a status check
    // can no longer read; eviction is documented as safe even when nothing is cached, so
    // offering it here gives a person a way out that does not depend on the error's cause.
    canRemove: phase.kind === "present" || phase.kind === "error",
    canCancel: phase.kind === "downloading",
    busy: phase.kind === "downloading" || phase.kind === "removing",
  };
}

/** Refusals that belong to the device rather than to any entry: every entry shares them. */
const DEVICE_REASONS: ReadonlySet<UnsupportedReason> = new Set([
  "insecure_context",
  "webgpu_missing",
  "adapter_unavailable",
  "below_runtime_floor",
]);

/** A measured pass that kept fewer than this share of rephrasings is labelled as such. */
export const LOW_FAITHFULNESS_RATIO = 0.2;

export type LocalModelFaithfulnessKey = "unmeasured" | "low" | "measured";

/** Why one entry is not offered here, when the reason is the entry's own. */
export type LocalModelOptionRefusal =
  | { readonly kind: "missing_features" }
  | {
      readonly kind: "over_budget";
      readonly requiredMb: number;
      readonly budgetMb: number;
    };

export interface LocalModelOptionView {
  readonly modelId: string;
  readonly label: string;
  readonly vramMb: number;
  readonly licenceName: string;
  readonly attribution: string | null;
  readonly usePolicy: string | null;
  readonly isDefault: boolean;
  /** This entry is the one in effect on this device. */
  readonly chosen: boolean;
  /** This device admits the entry, so it may be chosen. */
  readonly selectable: boolean;
  readonly refusal?: LocalModelOptionRefusal;
  readonly faithfulness: LocalModelFaithfulnessKey;
}

/** Why the entry in effect is the default rather than the stored choice. */
export type LocalModelFallback = "stored_unknown" | "stored_ineligible";

export interface LocalModelChoiceView {
  readonly effectiveModelId: string;
  readonly fallback?: LocalModelFallback;
  /** A refusal every entry shares because it is the device's; shown once, not per entry. */
  readonly deviceRefusal?: UnsupportedReason;
  readonly options: readonly LocalModelOptionView[];
}

export interface LocalModelChoiceInput {
  readonly catalog: readonly LocalModelCatalogEntry[];
  readonly defaultModelId: string;
  /** What this device stored as the owner's choice, if anything. */
  readonly stored: string | undefined;
  /** This device's verdict per entry, or `undefined` while it is still being checked. */
  readonly verdicts: ReadonlyMap<string, LocalModelDeviceVerdict> | undefined;
}

function faithfulnessKey(
  faithfulness: LocalModelCatalogEntry["faithfulness"],
): LocalModelFaithfulnessKey {
  if (faithfulness === null) {
    return "unmeasured";
  }
  return faithfulness.admitted / faithfulness.total < LOW_FAITHFULNESS_RATIO
    ? "low"
    : "measured";
}

function refusalOf(
  verdict: LocalModelDeviceVerdict | undefined,
): LocalModelOptionRefusal | undefined {
  if (verdict?.kind === "over_budget") {
    return {
      kind: "over_budget",
      requiredMb: verdict.requiredMb,
      budgetMb: verdict.budgetMb,
    };
  }
  return verdict?.kind === "missing_features"
    ? { kind: "missing_features" }
    : undefined;
}

/**
 * Chosen, eligible and default, kept apart.
 *
 * The stored choice is in effect when the catalog still serves it and this device admits it.
 * Otherwise the default is, and the view says why — without erasing the stored choice, which
 * may be admitted again once whatever refused it changes. Nothing here fetches anything:
 * choosing an entry changes which entry the rest of the section is about, and no more.
 */
export function createLocalModelChoiceView(
  input: LocalModelChoiceInput,
): LocalModelChoiceView {
  const { catalog, defaultModelId, stored, verdicts } = input;
  const defaultVerdict = verdicts?.get(defaultModelId);
  const deviceRefusal =
    defaultVerdict !== undefined &&
    defaultVerdict.kind !== "usable" &&
    DEVICE_REASONS.has(defaultVerdict.kind)
      ? defaultVerdict.kind
      : undefined;

  let effectiveModelId = defaultModelId;
  let fallback: LocalModelFallback | undefined;
  if (stored !== undefined) {
    const storedVerdict = verdicts?.get(stored);
    if (!catalog.some((entry) => entry.modelId === stored)) {
      fallback = "stored_unknown";
    } else if (
      storedVerdict !== undefined &&
      storedVerdict.kind !== "usable" &&
      deviceRefusal === undefined
    ) {
      fallback = "stored_ineligible";
    } else {
      effectiveModelId = stored;
    }
  }

  const options = catalog.map((entry): LocalModelOptionView => {
    const verdict = verdicts?.get(entry.modelId);
    const refusal = refusalOf(verdict);
    return {
      modelId: entry.modelId,
      label: entry.label,
      vramMb: entry.vramMb,
      licenceName: entry.licenceName,
      attribution: entry.attribution,
      usePolicy: entry.usePolicy,
      isDefault: entry.modelId === defaultModelId,
      chosen: entry.modelId === effectiveModelId,
      selectable: verdict?.kind === "usable",
      ...(refusal === undefined ? {} : { refusal }),
      faithfulness: faithfulnessKey(entry.faithfulness),
    };
  });

  return {
    effectiveModelId,
    ...(fallback === undefined ? {} : { fallback }),
    ...(deviceRefusal === undefined ? {} : { deviceRefusal }),
    options,
  };
}
