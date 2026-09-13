// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { inspectDevice, RUNTIME_DEVICE_FLOORS } from "./device";

const generous = {
  maxBufferSize: 1 << 30,
  maxStorageBufferBindingSize: 1 << 30,
  maxComputeWorkgroupStorageSize: 64 << 10,
  maxStorageBuffersPerShaderStage: 10,
};

function gpuGranting(
  limits: Partial<typeof generous> | undefined,
  features: readonly string[] = ["shader-f16"],
) {
  return {
    requestAdapter: () =>
      Promise.resolve({
        ...(limits === undefined ? {} : { limits }),
        features: { has: (feature: string) => features.includes(feature) },
      }),
  };
}

describe("reading a device before asking anything of it", () => {
  it("accepts an adapter that clears every floor", async () => {
    await expect(inspectDevice(gpuGranting(generous), true)).resolves.toEqual({
      kind: "usable",
      shaderF16: true,
    });
  });

  it("refuses an insecure context before looking for WebGPU", async () => {
    await expect(inspectDevice(undefined, false)).resolves.toEqual({
      kind: "insecure_context",
    });
  });

  it("separates a missing WebGPU from an adapter it would not grant", async () => {
    await expect(inspectDevice(undefined, true)).resolves.toEqual({
      kind: "webgpu_missing",
    });
    await expect(
      inspectDevice({ requestAdapter: () => Promise.resolve(null) }, true),
    ).resolves.toEqual({ kind: "adapter_unavailable" });
  });

  it("names the limit that fell short, one floor at a time", async () => {
    for (const [limit, floor] of Object.entries(RUNTIME_DEVICE_FLOORS)) {
      const verdict = await inspectDevice(
        gpuGranting({ ...generous, [limit]: floor - 1 }),
        true,
      );

      expect(verdict).toEqual({
        kind: "below_runtime_floor",
        limit,
        granted: floor - 1,
      });
    }
  });

  /** Ten storage buffers per shader stage is above the WebGPU default of eight. */
  it("refuses the WebGPU default storage buffer count", async () => {
    await expect(
      inspectDevice(
        gpuGranting({ ...generous, maxStorageBuffersPerShaderStage: 8 }),
        true,
      ),
    ).resolves.toEqual({
      kind: "below_runtime_floor",
      limit: "maxStorageBuffersPerShaderStage",
      granted: 8,
    });
  });

  it("does not call a limit short because the adapter did not report it", async () => {
    await expect(inspectDevice(gpuGranting(undefined), true)).resolves.toEqual({
      kind: "usable",
      shaderF16: true,
    });
  });

  it("reports a device without shader-f16 as usable but says so", async () => {
    await expect(
      inspectDevice(gpuGranting(generous, []), true),
    ).resolves.toEqual({
      kind: "usable",
      shaderF16: false,
    });
  });
});
