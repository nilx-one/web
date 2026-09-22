// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { LocalInferenceError } from "@aiaiaiai/webllm";
import { describe, expect, it } from "vitest";

import {
  describeMirrorDownload,
  loadMirrorManifest,
  mirrorCatalog,
  MirrorConfigError,
  type MirrorManifest,
} from "./mirror";

const MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

function manifest(overrides: Partial<MirrorManifest> = {}): MirrorManifest {
  return {
    schema: 1,
    model_id: MODEL_ID,
    revision: "1",
    bytes: 402_653_184,
    integrity: {
      config: "sha256-t5YG+zr+pb0WCe1AtiIULxyYElq8/omnamYbDo40ORA=",
      tokenizer: {
        "tokenizer.json": "sha256-X5fjd0xR7dHWNwbC7DgmxWSgZ3lHcM2rD4xHl5ccrPk=",
      },
      model_lib: "sha256-drWjVzkSdrKCpRb1T0jvPCB/RtgZLcWMII1Rg9OEFfg=",
    },
    ...overrides,
  };
}

describe("loading a model from our own origin", () => {
  it("serves the model from a revision WebLLM will not rewrite", () => {
    const [model] = mirrorCatalog("https://nilx.one", manifest()).models;

    expect(model?.artifacts).toBe(
      `https://nilx.one/models/${MODEL_ID}/resolve/1/`,
    );
    expect(model?.modelLib).toBe(
      `https://nilx.one/models/${MODEL_ID}/resolve/1/model.wasm`,
    );
    // WebLLM appends `resolve/main/` only to a URL that does not already name a revision.
    expect(model?.artifacts).toMatch(/\/resolve\/[^/]+\/$/);
  });

  it("declares the feature the prebuilt registry leaves off this entry", () => {
    const [model] = mirrorCatalog("https://nilx.one", manifest()).models;

    expect(model?.requiredFeatures).toEqual(["shader-f16"]);
  });

  it("carries the hashes WebLLM can verify", () => {
    const [model] = mirrorCatalog("https://nilx.one", manifest()).models;

    expect(model?.integrity).toEqual({
      config: "sha256-t5YG+zr+pb0WCe1AtiIULxyYElq8/omnamYbDo40ORA=",
      modelLib: "sha256-drWjVzkSdrKCpRb1T0jvPCB/RtgZLcWMII1Rg9OEFfg=",
      tokenizer: {
        "tokenizer.json": "sha256-X5fjd0xR7dHWNwbC7DgmxWSgZ3lHcM2rD4xHl5ccrPk=",
      },
    });
  });

  it("keeps only the model it was given", () => {
    expect(mirrorCatalog("https://nilx.one", manifest()).models).toHaveLength(
      1,
    );
  });

  it("leaves the cache backend to the caller", () => {
    expect(
      mirrorCatalog("https://nilx.one", manifest()).cacheBackend,
    ).toBeUndefined();
    expect(
      mirrorCatalog("https://nilx.one", manifest(), "opfs").cacheBackend,
    ).toBe("opfs");
  });

  it("states the download size without asking the network", () => {
    expect(describeMirrorDownload(manifest())).toEqual({ bytes: 402_653_184 });
  });
});

describe("what a mirror catalog refuses", () => {
  it("refuses a plaintext origin, local development included", () => {
    expect(() => mirrorCatalog("http://nilx.one", manifest())).toThrow(
      LocalInferenceError,
    );
    expect(() => mirrorCatalog("http://localhost:5173", manifest())).toThrow(
      LocalInferenceError,
    );
  });

  it("refuses a manifest schema it does not know how to read", () => {
    expect(() =>
      mirrorCatalog("https://nilx.one", manifest({ schema: 2 })),
    ).toThrow(/schema 2/);
  });

  it("refuses identifiers that would not stay inside one path segment", () => {
    for (const model_id of ["../etc", "a/b", ""]) {
      expect(() =>
        mirrorCatalog("https://nilx.one", manifest({ model_id })),
      ).toThrow(MirrorConfigError);
    }
  });

  it("refuses a revision that moves", () => {
    expect(() =>
      mirrorCatalog("https://nilx.one", manifest({ revision: "main" })),
    ).toThrow(/moving revision/);
  });

  it("refuses a hash that is not SRI", () => {
    const broken = manifest({
      integrity: {
        config: "deadbeef",
        tokenizer: {
          "tokenizer.json":
            "sha256-X5fjd0xR7dHWNwbC7DgmxWSgZ3lHcM2rD4xHl5ccrPk=",
        },
        model_lib: "sha256-drWjVzkSdrKCpRb1T0jvPCB/RtgZLcWMII1Rg9OEFfg=",
      },
    });

    expect(() => mirrorCatalog("https://nilx.one", broken)).toThrow(/SRI hash/);
  });

  it("refuses a manifest that does not state what it is offering", () => {
    expect(() =>
      mirrorCatalog("https://nilx.one", manifest({ bytes: 0 })),
    ).toThrow(/download size/);
  });
});

describe("reading the manifest a deployment wrote", () => {
  const ok = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    }) as unknown as Response;

  it("asks the revision directory for it", async () => {
    const asked: string[] = [];

    await loadMirrorManifest("https://nilx.one", MODEL_ID, "1", (input) => {
      asked.push(String(input));
      return Promise.resolve(ok(manifest()));
    });

    expect(asked).toEqual([
      `https://nilx.one/models/${MODEL_ID}/resolve/1/manifest.json`,
    ]);
  });

  it("does not ask a plaintext origin", async () => {
    await expect(
      loadMirrorManifest("http://localhost:5173", MODEL_ID, "1", () =>
        Promise.reject(new Error("should not be asked")),
      ),
    ).resolves.toBeNull();
  });

  it("returns nothing when the deployment has no such revision", async () => {
    await expect(
      loadMirrorManifest("https://nilx.one", MODEL_ID, "1", () =>
        Promise.resolve({ ok: false, status: 404 } as unknown as Response),
      ),
    ).resolves.toBeNull();

    await expect(
      loadMirrorManifest("https://nilx.one", MODEL_ID, "1", () =>
        Promise.reject(new Error("offline")),
      ),
    ).resolves.toBeNull();
  });

  it("refuses a manifest describing a different model than the one asked for", async () => {
    await expect(
      loadMirrorManifest("https://nilx.one", MODEL_ID, "1", () =>
        Promise.resolve(ok(manifest({ revision: "2" }))),
      ),
    ).resolves.toBeNull();
  });
});
