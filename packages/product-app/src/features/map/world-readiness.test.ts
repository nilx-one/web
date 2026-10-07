// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import type { LocalModelDependency } from "../../shell/local-model-host";
import { readLocalModelReadiness } from "./use-local-model-readiness";
import { createWorldReadiness } from "./world-readiness";

const READY_MAP = { kind: "ready" } as const;
const IDLE_LOCATION = { kind: "idle" } as const;

describe("world readiness", () => {
  it("is red when the map itself did not load", () => {
    const readiness = createWorldReadiness({
      map: { kind: "unavailable", reason: "styleLoadFailed" },
      location: IDLE_LOCATION,
      model: { kind: "present" },
    });

    expect(readiness.tone).toBe("failed");
    // The renderer's own notice already names it.
    expect(readiness.issues).toEqual([]);
  });

  it("is orange and says why when WebGPU cannot run the model", () => {
    const readiness = createWorldReadiness({
      map: READY_MAP,
      location: IDLE_LOCATION,
      model: { kind: "unsupported", reason: "webgpu_missing" },
    });

    expect(readiness.tone).toBe("degraded");
    expect(readiness.issues).toEqual([
      {
        id: "readiness-webgpu-webgpu_missing",
        title: "readiness.webgpu.title",
        detail: "settings.localModel.status.unsupportedNoWebgpu",
      },
    ]);
  });

  it("is orange when location permission was refused", () => {
    const readiness = createWorldReadiness({
      map: READY_MAP,
      location: { kind: "denied" },
      model: { kind: "present" },
    });

    expect(readiness.tone).toBe("degraded");
    expect(readiness.issues.map((issue) => issue.id)).toEqual([
      "readiness-location-denied",
    ]);
  });

  it("keeps a failed map red while still listing what else is wrong", () => {
    const readiness = createWorldReadiness({
      map: { kind: "unavailable", reason: "webglUnavailable" },
      location: { kind: "denied" },
      model: { kind: "error" },
    });

    expect(readiness.tone).toBe("failed");
    expect(readiness.issues.map((issue) => issue.id)).toEqual([
      "readiness-location-denied",
      "readiness-webgpu-error",
    ]);
  });

  it("does not treat a host without location as a refusal", () => {
    const readiness = createWorldReadiness({
      map: READY_MAP,
      location: { kind: "unsupported" },
      model: { kind: "available" },
    });

    expect(readiness).toEqual({ tone: "ready", issues: [] });
  });

  it("is pending while the map loads or the device is still being asked", () => {
    expect(
      createWorldReadiness({
        map: { kind: "loading" },
        location: IDLE_LOCATION,
        model: { kind: "present" },
      }).tone,
    ).toBe("pending");
    expect(
      createWorldReadiness({
        map: READY_MAP,
        location: IDLE_LOCATION,
        model: { kind: "checking" },
      }).tone,
    ).toBe("pending");
  });

  it("is cyan when ready without the model, green once WebLLM has it", () => {
    expect(
      createWorldReadiness({
        map: READY_MAP,
        location: IDLE_LOCATION,
        model: { kind: "available" },
      }).tone,
    ).toBe("ready");
    expect(
      createWorldReadiness({
        map: READY_MAP,
        location: IDLE_LOCATION,
        model: { kind: "not-wired" },
      }).tone,
    ).toBe("ready");
    expect(
      createWorldReadiness({
        map: READY_MAP,
        location: IDLE_LOCATION,
        model: { kind: "present" },
      }).tone,
    ).toBe("connected");
  });
});

function dependency(
  overrides: Partial<LocalModelDependency["host"]> = {},
): LocalModelDependency {
  return {
    defaultModelId: "small",
    catalog: [
      {
        modelId: "small",
        family: "qwen",
        label: "Small",
        vramMb: 512,
        licence: "Apache-2.0",
        licenceName: "Apache 2.0",
        attribution: null,
        usePolicy: null,
        notices: [],
        faithfulness: null,
      },
    ],
    host: {
      inspect: () => Promise.resolve({ kind: "usable" }),
      isCached: () => Promise.resolve(false),
      describe: () => Promise.resolve({ bytes: null, source: "mirror" }),
      open: () => Promise.reject(new Error("never opened")),
      remove: () => Promise.resolve(),
      ...overrides,
    },
  };
}

describe("reading the on-device model's readiness", () => {
  it("reports a WebGPU refusal without asking the cache", async () => {
    let asked = false;
    const readiness = await readLocalModelReadiness(
      dependency({
        inspect: () => Promise.resolve({ kind: "adapter_unavailable" }),
        isCached: () => {
          asked = true;
          return Promise.resolve(true);
        },
      }),
      undefined,
    );

    expect(readiness).toEqual({
      kind: "unsupported",
      reason: "adapter_unavailable",
    });
    expect(asked).toBe(false);
  });

  it("says whether the usable model is already cached", async () => {
    await expect(
      readLocalModelReadiness(dependency(), undefined),
    ).resolves.toEqual({ kind: "available" });
    await expect(
      readLocalModelReadiness(
        dependency({ isCached: () => Promise.resolve(true) }),
        undefined,
      ),
    ).resolves.toMatchObject({ kind: "present", modelId: expect.any(String) });
  });

  it("reads an unreadable cache as a model not here yet", async () => {
    await expect(
      readLocalModelReadiness(
        dependency({ isCached: () => Promise.reject(new Error("truncated")) }),
        undefined,
      ),
    ).resolves.toEqual({ kind: "available" });
  });
});
