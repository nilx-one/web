// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  describeMirrorDownload,
  loadMirrorManifest,
  mirrorAppConfig,
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
      config: "sha256-Y29uZmln",
      tokenizer: { "tokenizer.json": "sha256-dG9rZW5pemVy" },
      model_lib: "sha256-bGli",
    },
    ...overrides,
  };
}

describe("loading a model from our own origin", () => {
  it("serves the model from a revision WebLLM will not rewrite", () => {
    const [record] = mirrorAppConfig("https://nilx.one", manifest()).model_list;

    expect(record?.model).toBe(
      `https://nilx.one/models/${MODEL_ID}/resolve/1/`,
    );
    expect(record?.model_lib).toBe(
      `https://nilx.one/models/${MODEL_ID}/resolve/1/model.wasm`,
    );
    // WebLLM appends `resolve/main/` only to a URL that does not already name a revision.
    expect(record?.model).toMatch(/\/resolve\/[^/]+\/$/);
  });

  it("declares the feature the prebuilt registry leaves off this entry", () => {
    const [record] = mirrorAppConfig("https://nilx.one", manifest()).model_list;

    expect(record?.required_features).toEqual(["shader-f16"]);
  });

  it("carries the hashes WebLLM can verify, and fails closed on a mismatch", () => {
    const [record] = mirrorAppConfig("https://nilx.one", manifest()).model_list;

    expect(record?.integrity).toEqual({
      config: "sha256-Y29uZmln",
      model_lib: "sha256-bGli",
      tokenizer: { "tokenizer.json": "sha256-dG9rZW5pemVy" },
      onFailure: "error",
    });
  });

  it("keeps only the model it was given", () => {
    expect(
      mirrorAppConfig("https://nilx.one", manifest()).model_list,
    ).toHaveLength(1);
  });

  it("states the download size without asking the network", () => {
    expect(describeMirrorDownload(manifest())).toEqual({ bytes: 402_653_184 });
  });
});

describe("what a mirror config refuses", () => {
  it("refuses a plaintext origin but allows local development", () => {
    expect(() => mirrorAppConfig("http://nilx.one", manifest())).toThrow(
      MirrorConfigError,
    );
    expect(() =>
      mirrorAppConfig("http://localhost:5173", manifest()),
    ).not.toThrow();
  });

  it("refuses a manifest schema it does not know how to read", () => {
    expect(() =>
      mirrorAppConfig("https://nilx.one", manifest({ schema: 2 })),
    ).toThrow(/schema 2/);
  });

  it("refuses identifiers that would not stay inside one path segment", () => {
    for (const model_id of ["../etc", "a/b", ""]) {
      expect(() =>
        mirrorAppConfig("https://nilx.one", manifest({ model_id })),
      ).toThrow(MirrorConfigError);
    }
  });

  it("refuses a hash that is not SRI", () => {
    const broken = manifest({
      integrity: {
        config: "deadbeef",
        tokenizer: { "tokenizer.json": "sha256-dG9rZW5pemVy" },
        model_lib: "sha256-bGli",
      },
    });

    expect(() => mirrorAppConfig("https://nilx.one", broken)).toThrow(
      /not an SRI hash/,
    );
  });

  it("refuses a manifest that does not state what it is offering", () => {
    expect(() =>
      mirrorAppConfig("https://nilx.one", manifest({ bytes: 0 })),
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
