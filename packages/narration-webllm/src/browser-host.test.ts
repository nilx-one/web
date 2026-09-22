// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  describeDownload,
  describeLocalModelDownload,
  narrationAppConfig,
  resolveLocalModelSource,
} from "./browser-host";
import { NARRATION_MODEL_ID } from "./index";
import type { MirrorManifest } from "./mirror";

const ORIGIN = "https://nilx.one";

function manifestResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function mirrorManifest(
  overrides: Partial<MirrorManifest> = {},
): MirrorManifest {
  return {
    schema: 1,
    model_id: NARRATION_MODEL_ID,
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

describe("the config this product loads under", () => {
  it("declares the feature the registry omits on this entry", () => {
    const record = narrationAppConfig().model_list.find(
      (entry) => entry.model_id === NARRATION_MODEL_ID,
    );

    expect(record?.required_features).toEqual(["shader-f16"]);
  });

  it("leaves every other registry entry as it found it", () => {
    const config = narrationAppConfig();
    const others = config.model_list.filter(
      (entry) => entry.model_id !== NARRATION_MODEL_ID,
    );

    expect(others.some((entry) => entry.required_features === undefined)).toBe(
      true,
    );
  });

  it("chooses a cache backend rather than leaving it to a default", () => {
    expect(["opfs", "cache"]).toContain(narrationAppConfig().cacheBackend);
  });
});

describe("describing a download before it starts", () => {
  const requested: string[] = [];
  const fetchManifest = (input: URL | RequestInfo): Promise<Response> => {
    requested.push(String(input));
    return Promise.resolve(
      manifestResponse({ records: [{ nbytes: 1000 }, { nbytes: 2500 }] }),
    );
  };

  it("sums the shards the manifest declares", async () => {
    await expect(
      describeDownload(NARRATION_MODEL_ID, narrationAppConfig(), fetchManifest),
    ).resolves.toEqual({ bytes: 3500 });
  });

  it("asks for the manifest at the revision the loader will use", async () => {
    await describeDownload(
      NARRATION_MODEL_ID,
      narrationAppConfig(),
      fetchManifest,
    );

    expect(requested.at(-1)).toContain("/resolve/main/ndarray-cache.json");
  });

  it("preserves an explicit immutable revision without appending main", async () => {
    const config = narrationAppConfig();
    const model_list = config.model_list.map((entry) =>
      entry.model_id === NARRATION_MODEL_ID
        ? {
            ...entry,
            model:
              "https://example.test/models/Qwen3-0.6B-q4f16_1-MLC/resolve/1/",
          }
        : entry,
    );

    await describeDownload(
      NARRATION_MODEL_ID,
      { ...config, model_list },
      fetchManifest,
    );

    expect(requested.at(-1)).toBe(
      "https://example.test/models/Qwen3-0.6B-q4f16_1-MLC/resolve/1/ndarray-cache.json",
    );
  });

  it("says it does not know rather than guessing a size", async () => {
    await expect(
      describeDownload(NARRATION_MODEL_ID, narrationAppConfig(), () =>
        Promise.reject(new Error("offline")),
      ),
    ).resolves.toEqual({ bytes: null, reason: "manifest_unreachable" });

    await expect(
      describeDownload(NARRATION_MODEL_ID, narrationAppConfig(), () =>
        Promise.resolve(manifestResponse({}, false, 404)),
      ),
    ).resolves.toEqual({ bytes: null, reason: "manifest_http_404" });

    await expect(
      describeDownload(NARRATION_MODEL_ID, narrationAppConfig(), () =>
        Promise.resolve(manifestResponse({ records: [] })),
      ),
    ).resolves.toEqual({ bytes: null, reason: "manifest_without_sizes" });
  });

  it("refuses a model the config does not carry", async () => {
    await expect(
      describeDownload("not-a-model", narrationAppConfig(), fetchManifest),
    ).resolves.toEqual({ bytes: null, reason: "model_not_in_config" });
  });
});

describe("choosing where this device loads from", () => {
  const manifestUrl = `${ORIGIN}/models/${NARRATION_MODEL_ID}/resolve/1/manifest.json`;

  it("prefers this deployment's mirror when a manifest answers", async () => {
    const resolved = await resolveLocalModelSource(
      NARRATION_MODEL_ID,
      ORIGIN,
      "1",
      (input) =>
        String(input) === manifestUrl
          ? Promise.resolve(manifestResponse(mirrorManifest()))
          : Promise.reject(new Error(`unexpected request: ${input}`)),
    );

    expect(resolved.kind).toBe("mirror");
    expect(resolved.appConfig.model_list[0]?.model).toBe(
      `${ORIGIN}/models/${NARRATION_MODEL_ID}/resolve/1/`,
    );
  });

  it("falls back to the pinned upstream registry when this deployment has no mirror", async () => {
    const resolved = await resolveLocalModelSource(
      NARRATION_MODEL_ID,
      ORIGIN,
      "1",
      () => Promise.resolve({ ok: false, status: 404 } as unknown as Response),
    );

    expect(resolved.kind).toBe("upstream");
  });

  it("falls back to upstream rather than load from a manifest it cannot trust", async () => {
    const untrusted = mirrorManifest({
      integrity: {
        config: "not-sri",
        tokenizer: { "tokenizer.json": "sha256-dG9rZW5pemVy" },
        model_lib: "sha256-bGli",
      },
    });

    const resolved = await resolveLocalModelSource(
      NARRATION_MODEL_ID,
      ORIGIN,
      "1",
      () => Promise.resolve(manifestResponse(untrusted)),
    );

    expect(resolved.kind).toBe("upstream");
  });
});

describe("describing the download regardless of where it comes from", () => {
  it("states the mirror's own size with no second request", async () => {
    const requested: string[] = [];
    const fetchImpl = (input: URL | RequestInfo): Promise<Response> => {
      requested.push(String(input));
      return Promise.resolve(manifestResponse(mirrorManifest({ bytes: 500 })));
    };

    await expect(
      describeLocalModelDownload(NARRATION_MODEL_ID, ORIGIN, "1", fetchImpl),
    ).resolves.toEqual({ bytes: 500, source: "mirror", notices: [] });
    expect(requested).toHaveLength(1);
  });

  it("carries a mirror's redistribution notices through", async () => {
    const notices = ["Model weights converted and published by mlc-ai."];
    const fetchImpl = () =>
      Promise.resolve(manifestResponse(mirrorManifest({ notices })));

    await expect(
      describeLocalModelDownload(NARRATION_MODEL_ID, ORIGIN, "1", fetchImpl),
    ).resolves.toEqual({ bytes: 402_653_184, source: "mirror", notices });
  });

  it("sums the upstream registry's shards when there is no mirror", async () => {
    const fetchImpl = (input: URL | RequestInfo): Promise<Response> =>
      String(input).endsWith("manifest.json")
        ? Promise.resolve({ ok: false, status: 404 } as unknown as Response)
        : Promise.resolve(
            manifestResponse({ records: [{ nbytes: 1000 }, { nbytes: 2500 }] }),
          );

    await expect(
      describeLocalModelDownload(NARRATION_MODEL_ID, ORIGIN, "1", fetchImpl),
    ).resolves.toEqual({ bytes: 3500, source: "upstream", notices: [] });
  });

  it("says which source it could not describe from", async () => {
    const fetchImpl = () => Promise.reject(new Error("offline"));

    await expect(
      describeLocalModelDownload(NARRATION_MODEL_ID, ORIGIN, "1", fetchImpl),
    ).resolves.toEqual({
      bytes: null,
      reason: "manifest_unreachable",
      source: "upstream",
    });
  });
});
