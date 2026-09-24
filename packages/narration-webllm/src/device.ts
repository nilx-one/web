// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Whether this surface can run a local model at all.
 *
 * The probe itself and the floors it is measured against are `@aiaiaiai/webllm`'s: the
 * runtime it pins asks `requestDevice` for limits above the WebGPU defaults, so a current
 * device can offer an adapter and still be one nothing will load on. What is decided here is
 * only the product's reading of that probe — one verdict, named in this product's terms.
 *
 * The model's own requirements are checked here too, before anything is fetched. A `…f16…`
 * model cannot compile its kernels without `shader-f16`, and an adapter that lacks it would
 * otherwise be offered a download it can never run.
 */

import {
  belowRuntimeFloor,
  missingFeatures,
  requiredFeaturesFor,
  type DeviceLimit,
  type WebGpuProbe,
} from "@aiaiaiai/webllm";

export { RUNTIME_DEVICE_FLOORS } from "@aiaiaiai/webllm";

export type RuntimeDeviceLimit = DeviceLimit;

export type DeviceVerdict =
  | { readonly kind: "usable" }
  | { readonly kind: "insecure_context" }
  | { readonly kind: "webgpu_missing" }
  | { readonly kind: "adapter_unavailable" }
  | {
      readonly kind: "below_runtime_floor";
      readonly limit: RuntimeDeviceLimit;
      readonly granted: number;
    }
  | {
      readonly kind: "missing_features";
      readonly missing: readonly string[];
    }
  | {
      readonly kind: "over_budget";
      /** What the entry states it needs, in MB: the registry's claim, not a reading. */
      readonly requiredMb: number;
      /** What this surface declared it will spend, in MB: policy, not a reading. */
      readonly budgetMb: number;
    };

/**
 * Reads a probe for one model, without downloading, loading, or requesting a GPU device.
 *
 * A limit an adapter did not report is not treated as short: an absent value is unknown,
 * and refusing on it would turn a reporting gap into a verdict about someone's device.
 */
export function deviceVerdict(
  probe: WebGpuProbe,
  modelId: string,
): DeviceVerdict {
  if (!probe.supported) {
    return probe.reason === "webgpu_adapter_unavailable"
      ? { kind: "adapter_unavailable" }
      : { kind: probe.reason };
  }

  const { capability } = probe;
  const limit = belowRuntimeFloor(capability);
  if (limit !== undefined) {
    // `belowRuntimeFloor` only names a limit the adapter reported, so this is defined.
    return {
      kind: "below_runtime_floor",
      limit,
      granted: capability[limit] ?? 0,
    };
  }

  const missing = missingFeatures(capability, requiredFeaturesFor(modelId));
  return missing.length === 0
    ? { kind: "usable" }
    : { kind: "missing_features", missing };
}

/**
 * One catalog entry's verdict: the device's first, then the budget this surface declared.
 *
 * The order is the one `nilx-one/ai`'s `eligible_local_models` checks in — runtime floor,
 * features, budget — and both are tested against the same fixture
 * (`local-model-eligibility.json`), so an entry cannot be offered in one and refused in the
 * other. An undeclared budget refuses nothing: no budget is a declaration this surface did not
 * make, not a measurement that came back empty.
 */
export function entryVerdict(
  probe: WebGpuProbe,
  entry: { readonly modelId: string; readonly vramMb: number },
  budgetMb?: number,
): DeviceVerdict {
  const verdict = deviceVerdict(probe, entry.modelId);
  if (verdict.kind !== "usable" || budgetMb === undefined) {
    return verdict;
  }
  return entry.vramMb > budgetMb
    ? { kind: "over_budget", requiredMb: entry.vramMb, budgetMb }
    : verdict;
}
