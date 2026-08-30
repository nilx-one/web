// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import { selectGraphicsBackend } from "./index";

describe("selectGraphicsBackend", () => {
  it("selects WebGPU when an adapter is available", async () => {
    const createWebGl2Context = vi.fn(() => ({}));

    await expect(
      selectGraphicsBackend({
        requestWebGpuAdapter: async () => ({}),
        createWebGl2Context,
      }),
    ).resolves.toEqual({
      backend: "webgpu",
      webGpuAttempted: true,
    });
    expect(createWebGl2Context).not.toHaveBeenCalled();
  });

  it("falls back to WebGL2 when WebGPU adapter acquisition returns null", async () => {
    await expect(
      selectGraphicsBackend({
        requestWebGpuAdapter: async () => null,
        createWebGl2Context: () => ({}),
      }),
    ).resolves.toEqual({
      backend: "webgl2",
      webGpuAttempted: true,
    });
  });

  it("falls back to WebGL2 when WebGPU adapter acquisition throws", async () => {
    await expect(
      selectGraphicsBackend({
        requestWebGpuAdapter: () =>
          Promise.reject(new Error("fixture adapter loss")),
        createWebGl2Context: () => ({}),
      }),
    ).resolves.toEqual({
      backend: "webgl2",
      webGpuAttempted: true,
    });
  });

  it("returns an explicit unsupported state without either backend", async () => {
    await expect(
      selectGraphicsBackend({
        createWebGl2Context: () => null,
      }),
    ).resolves.toEqual({
      backend: "unsupported",
      webGpuAttempted: false,
    });
  });
});
