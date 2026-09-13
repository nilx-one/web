// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Whether this surface can run a local model at all.
 *
 * An adapter is not a device. WebLLM asks `requestDevice` for 1 GiB of `maxBufferSize` and
 * `maxStorageBufferBindingSize`, falls back once to the values below, and throws beneath
 * them; it also requires 32 KiB of `maxComputeWorkgroupStorageSize` and **ten** storage
 * buffers per shader stage, neither with a fallback. Ten is above the WebGPU default of
 * eight, so a current device can offer an adapter and still be one nothing will load on.
 *
 * These numbers are `RUNTIME_DEVICE_FLOORS` in `@aiaiaiai/webllm`, which is where they
 * belong. They are repeated here only because that package is not published yet
 * (`nilx-one/ai#17`); this file is deleted, not maintained, once it is.
 */

export const RUNTIME_DEVICE_FLOORS = {
  maxBufferSize: 1 << 28,
  maxStorageBufferBindingSize: 1 << 27,
  maxComputeWorkgroupStorageSize: 32 << 10,
  maxStorageBuffersPerShaderStage: 10,
} as const;

export type RuntimeDeviceLimit = keyof typeof RUNTIME_DEVICE_FLOORS;

export type DeviceVerdict =
  | { readonly kind: "usable"; readonly shaderF16: boolean }
  | { readonly kind: "insecure_context" }
  | { readonly kind: "webgpu_missing" }
  | { readonly kind: "adapter_unavailable" }
  | {
      readonly kind: "below_runtime_floor";
      readonly limit: RuntimeDeviceLimit;
      readonly granted: number;
    };

interface GpuAdapterLike {
  readonly limits?: Partial<Record<RuntimeDeviceLimit, number>>;
  readonly features?: { has(feature: string): boolean };
}

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

/** Reads the device without downloading, loading, or requesting a GPU device. */
export async function inspectDevice(
  gpu: GpuLike | undefined = (navigator as Navigator & { gpu?: GpuLike }).gpu,
  secureContext: boolean = globalThis.isSecureContext !== false,
): Promise<DeviceVerdict> {
  if (!secureContext) {
    return { kind: "insecure_context" };
  }
  if (gpu === undefined) {
    return { kind: "webgpu_missing" };
  }

  const adapter = await gpu.requestAdapter();
  if (adapter === null) {
    return { kind: "adapter_unavailable" };
  }

  const shortfall = firstShortfall(adapter.limits);
  if (shortfall !== undefined) {
    return { kind: "below_runtime_floor", ...shortfall };
  }

  return {
    kind: "usable",
    shaderF16: adapter.features?.has("shader-f16") === true,
  };
}

/**
 * The first limit granted below what the runtime requires.
 *
 * A limit an adapter does not report is not treated as short: an absent value is unknown,
 * and refusing on it would turn a reporting gap into a verdict about someone's device.
 */
function firstShortfall(
  limits: Partial<Record<RuntimeDeviceLimit, number>> | undefined,
): { limit: RuntimeDeviceLimit; granted: number } | undefined {
  if (limits === undefined) {
    return undefined;
  }
  for (const [name, floor] of Object.entries(RUNTIME_DEVICE_FLOORS)) {
    const limit = name as RuntimeDeviceLimit;
    const granted = limits[limit];
    if (typeof granted === "number" && granted < floor) {
      return { limit, granted };
    }
  }
  return undefined;
}
