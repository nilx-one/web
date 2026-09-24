// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { DeviceCapability } from "@aiaiaiai/webllm";
import { describe, expect, it } from "vitest";

import { deviceVerdict, entryVerdict, RUNTIME_DEVICE_FLOORS } from "./device";
import { NARRATION_MODEL_ID } from "./index";

const generous: DeviceCapability = {
  features: ["shader-f16"],
  maxBufferSize: 1 << 30,
  maxStorageBufferBindingSize: 1 << 30,
  maxComputeWorkgroupStorageSize: 64 << 10,
  maxStorageBuffersPerShaderStage: 10,
};

function supported(capability: DeviceCapability) {
  return { supported: true, capability } as const;
}

describe("reading a device before asking anything of it", () => {
  it("accepts an adapter that clears every floor and offers what the model needs", () => {
    expect(deviceVerdict(supported(generous), NARRATION_MODEL_ID)).toEqual({
      kind: "usable",
    });
  });

  it("names why a probe found nothing to run on", () => {
    expect(
      deviceVerdict(
        { supported: false, reason: "insecure_context" },
        NARRATION_MODEL_ID,
      ),
    ).toEqual({ kind: "insecure_context" });
    expect(
      deviceVerdict(
        { supported: false, reason: "webgpu_missing" },
        NARRATION_MODEL_ID,
      ),
    ).toEqual({ kind: "webgpu_missing" });
    expect(
      deviceVerdict(
        { supported: false, reason: "webgpu_adapter_unavailable" },
        NARRATION_MODEL_ID,
      ),
    ).toEqual({ kind: "adapter_unavailable" });
  });

  it("names the first limit granted below the runtime floor, and what was granted", () => {
    expect(
      deviceVerdict(
        supported({ ...generous, maxStorageBuffersPerShaderStage: 8 }),
        NARRATION_MODEL_ID,
      ),
    ).toEqual({
      kind: "below_runtime_floor",
      limit: "maxStorageBuffersPerShaderStage",
      granted: 8,
    });
  });

  it("uses the foundation's floors rather than a copy of them", () => {
    expect(RUNTIME_DEVICE_FLOORS.maxStorageBuffersPerShaderStage).toBe(10);
  });

  it("does not refuse a limit the adapter never reported", () => {
    expect(
      deviceVerdict(
        supported({ features: ["shader-f16"] }),
        NARRATION_MODEL_ID,
      ),
    ).toEqual({ kind: "usable" });
  });

  it("refuses before any download when the adapter lacks what an f16 model needs", () => {
    expect(
      deviceVerdict(
        supported({ ...generous, features: [] }),
        NARRATION_MODEL_ID,
      ),
    ).toEqual({ kind: "missing_features", missing: ["shader-f16"] });
  });
});

describe("an entry against the budget this surface declared", () => {
  const entry = { modelId: NARRATION_MODEL_ID, vramMb: 1403.34 };

  it("refuses an entry above the budget, naming both claims", () => {
    expect(entryVerdict(supported(generous), entry, 1024)).toEqual({
      kind: "over_budget",
      requiredMb: 1403.34,
      budgetMb: 1024,
    });
  });

  it("admits an entry within it", () => {
    expect(entryVerdict(supported(generous), entry, 2048)).toEqual({
      kind: "usable",
    });
  });

  it("refuses nothing for size when no budget was declared", () => {
    expect(entryVerdict(supported(generous), entry)).toEqual({
      kind: "usable",
    });
  });

  it("names the device's refusal before the budget's", () => {
    expect(
      entryVerdict({ supported: false, reason: "webgpu_missing" }, entry, 1),
    ).toEqual({ kind: "webgpu_missing" });
  });
});
