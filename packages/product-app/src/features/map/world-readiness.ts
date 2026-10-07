// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapRendererStatus } from "@nilx-one/map-contract";

import type { UnsupportedReason } from "../../shell/local-model-settings-view-model";
import type { TranslationKey } from "../../shell/localization";
import type { DeviceLocationState } from "./device-location";

/**
 * What this device knows about its on-device model, without loading it: whether WebGPU can
 * run the model in effect, and whether that model's artifacts are already here.
 */
export type LocalModelReadiness =
  /** This deployment wires no local model; nothing is asked and nothing is owed. */
  | { readonly kind: "not-wired" }
  | { readonly kind: "checking" }
  | { readonly kind: "unsupported"; readonly reason: UnsupportedReason }
  /** WebGPU can run it; the model is not on this device yet. */
  | { readonly kind: "available" }
  /** WebGPU can run it and the model is cached here: WebLLM has what it needs. */
  | {
      readonly kind: "present";
      /** The entry in effect, the one a choice would load. */
      readonly modelId?: string;
    }
  /** The probe itself threw; nothing can be said about this device. */
  | { readonly kind: "error" };

/**
 * The colour of the frame around the world, worst first:
 * - `failed`: the world itself did not load;
 * - `degraded`: the world is here, something it leans on is not;
 * - `pending`: still being found out;
 * - `ready`: everything answered, the model is not downloaded yet;
 * - `connected`: everything answered and the model is on this device.
 */
export type WorldReadinessTone =
  "failed" | "degraded" | "pending" | "ready" | "connected";

export interface WorldReadinessIssue {
  /** Stable while the cause stays the same, so a dismissed notice stays dismissed. */
  readonly id: string;
  readonly title: TranslationKey;
  readonly detail: TranslationKey;
}

export interface WorldReadiness {
  readonly tone: WorldReadinessTone;
  /**
   * Problems the frame alone cannot name, said again as notices. A map that failed is not
   * listed: the renderer's own notice already says so, in its own words.
   */
  readonly issues: readonly WorldReadinessIssue[];
}

const MODEL_DETAIL: Readonly<Record<UnsupportedReason, TranslationKey>> = {
  insecure_context: "settings.localModel.status.unsupportedInsecure",
  webgpu_missing: "settings.localModel.status.unsupportedNoWebgpu",
  adapter_unavailable: "settings.localModel.status.unsupportedNoAdapter",
  below_runtime_floor: "settings.localModel.status.unsupportedBelowFloor",
  missing_features: "settings.localModel.status.unsupportedFeatures",
  over_budget: "settings.localModel.status.unsupportedOverBudget",
};

function locationIssue(
  location: DeviceLocationState,
): WorldReadinessIssue | undefined {
  switch (location.kind) {
    case "denied":
      return {
        id: "readiness-location-denied",
        title: "location.denied.label",
        detail: "location.denied.hint",
      };
    default:
      // A host with no location at all, a transient miss, or a prompt still to
      // be answered is the location control's to say; none is a refusal.
      return undefined;
  }
}

function modelIssue(
  model: LocalModelReadiness,
): WorldReadinessIssue | undefined {
  switch (model.kind) {
    case "unsupported":
      return {
        id: `readiness-webgpu-${model.reason}`,
        title: "readiness.webgpu.title",
        detail: MODEL_DETAIL[model.reason],
      };
    case "error":
      return {
        id: "readiness-webgpu-error",
        title: "readiness.webgpu.title",
        detail: "readiness.webgpu.probeFailed",
      };
    default:
      return undefined;
  }
}

/** One reading of the map, location and on-device model, for the frame and its notices. */
export function createWorldReadiness(input: {
  readonly map: MapRendererStatus;
  readonly location: DeviceLocationState;
  readonly model: LocalModelReadiness;
}): WorldReadiness {
  const { map, location, model } = input;
  const issues = [locationIssue(location), modelIssue(model)].filter(
    (issue): issue is WorldReadinessIssue => issue !== undefined,
  );

  if (map.kind === "unavailable") return { tone: "failed", issues };
  if (issues.length > 0) return { tone: "degraded", issues };
  if (map.kind !== "ready" || model.kind === "checking") {
    return { tone: "pending", issues };
  }
  return { tone: model.kind === "present" ? "connected" : "ready", issues };
}
