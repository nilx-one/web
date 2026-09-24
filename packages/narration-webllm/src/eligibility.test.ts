// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The same cases `nilx-one/ai` tests `eligible_local_models` and `select_local_model` against.
 * `local-model-eligibility.json` is that repository's fixture, copied byte for byte; it is
 * changed there first. Two readings of one rule cannot drift apart while both hold.
 */

import type { WebGpuProbe } from "@aiaiaiai/webllm";
import { describe, expect, it } from "vitest";

import { defaultLocalModel, LOCAL_MODEL_CATALOG } from "./catalog";
import { entryVerdict, type DeviceVerdict } from "./device";
import fixture from "./local-model-eligibility.json";

interface FixtureDevice {
  readonly shader_f16: boolean;
  readonly max_buffer_size: number;
  readonly max_storage_buffer_binding_size: number;
  readonly max_compute_workgroup_storage_size: number;
  readonly max_storage_buffers_per_shader_stage: number;
}

function probeOf(device: FixtureDevice): WebGpuProbe {
  return {
    supported: true,
    capability: {
      features: device.shader_f16 ? ["shader-f16"] : [],
      maxBufferSize: device.max_buffer_size,
      maxStorageBufferBindingSize: device.max_storage_buffer_binding_size,
      maxComputeWorkgroupStorageSize: device.max_compute_workgroup_storage_size,
      maxStorageBuffersPerShaderStage:
        device.max_storage_buffers_per_shader_stage,
    },
  };
}

function fixtureWord(verdict: DeviceVerdict): string {
  switch (verdict.kind) {
    case "usable":
      return "eligible";
    case "over_budget":
      return "over_budget";
    case "missing_features":
      return verdict.missing.includes("shader-f16")
        ? "missing_shader_f16"
        : `missing_features:${verdict.missing.join(",")}`;
    case "below_runtime_floor":
      return `below_runtime_floor:${verdict.limit}`;
    default:
      return verdict.kind;
  }
}

describe("the eligibility rule nilx-one/ai owns", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const probe = probeOf(testCase.device);
      const expected = testCase.expected as Readonly<Record<string, string>>;

      for (const entry of LOCAL_MODEL_CATALOG.models) {
        expect(
          fixtureWord(entryVerdict(probe, entry, testCase.budget_mb)),
          entry.modelId,
        ).toBe(expected[entry.modelId]);
      }
      expect(
        fixtureWord(
          entryVerdict(
            probe,
            defaultLocalModel(LOCAL_MODEL_CATALOG),
            testCase.budget_mb,
          ),
        ),
      ).toBe(testCase.default);
    });
  }
});
