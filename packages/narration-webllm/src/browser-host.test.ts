// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { describeDownload, narrationAppConfig } from "./browser-host";
import { NARRATION_MODEL_ID } from "./index";

function manifestResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
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
