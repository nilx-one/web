// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from "vitest";

import {
  CORE_CONTRACT_VERSION,
  CORE_FIXTURE_CORPUS_DIGEST,
  CORE_FIXTURE_CORPUS_VERSION,
  createCoreWasmClient,
  loadGeneratedCoreWasmBindings,
  type GeneratedCoreWasmModule,
} from "./index";

function generatedRuntime(
  overrides: Partial<GeneratedCoreWasmModule> = {},
): GeneratedCoreWasmModule {
  return {
    default: vi.fn().mockResolvedValue({}),
    contract_version: () => CORE_CONTRACT_VERSION,
    fixture_corpus_version: () => CORE_FIXTURE_CORPUS_VERSION,
    fixture_corpus_digest: () => CORE_FIXTURE_CORPUS_DIGEST,
    ...overrides,
  };
}

describe("CoreWasmClient", () => {
  it("reports the absent generated artifact", async () => {
    await expect(createCoreWasmClient().probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "artifact-missing",
    });
  });

  it("reports a versioned generated binding", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " fixture-contract ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "ready",
      contractVersion: "fixture-contract",
    });
  });

  it("rejects an empty binding version", async () => {
    const client = createCoreWasmClient({
      loadBindings: async () => ({
        contractVersion: () => " ",
      }),
    });

    await expect(client.probe()).resolves.toEqual({
      kind: "unavailable",
      reason: "binding-invalid",
    });
  });

  it("accepts the generated runtime only after the full compatibility handshake", async () => {
    const runtime = generatedRuntime();
    const bindings = await loadGeneratedCoreWasmBindings(async () => runtime);

    expect(runtime.default).toHaveBeenCalledWith({
      module_or_path: "/core/0.1.0/index_bg.wasm",
    });
    expect(bindings.contractVersion()).toBe("0.1.0");
  });

  it("rejects a generated runtime with a different corpus digest", async () => {
    const runtime = generatedRuntime({
      fixture_corpus_digest: () => "sha256_wrong",
    });

    await expect(
      loadGeneratedCoreWasmBindings(async () => runtime),
    ).rejects.toThrow("compatibility verification");
  });
});
