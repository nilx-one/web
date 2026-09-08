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
    derive_pub_dress_label: (value) =>
      value === "0x0небо" ? "label:xn--0x0-dddt1cj" : "error:not_a_pub_dress",
    compose_pub_dress_label: (value, suffix) =>
      value === "0x0небо" && suffix === "42"
        ? "label:xn--0x042-3ve3g4f"
        : "error:invalid_character",
    pub_dress_unicode_version: () => "16.0.0",
    pub_dress_uts46_implementation: () =>
      "idna=1.1.0;idna_adapter=1.1.0;idna_mapping=1.1.0",
    validate_pub_dress: (value) => (value === "0x0небо" ? "valid" : "invalid"),
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
    const importRuntime = vi.fn(async () => runtime);
    const bindings = await loadGeneratedCoreWasmBindings({ importRuntime });

    expect(importRuntime).toHaveBeenCalledWith("/core/0.1.0/index.js");
    expect(runtime.default).toHaveBeenCalledWith({
      module_or_path: "/core/0.1.0/index_bg.wasm",
    });
    expect(bindings.contractVersion()).toBe("0.1.0");
    expect(bindings.derivePubDressLabel?.("0x0небо")).toEqual({
      kind: "label",
      label: "xn--0x0-dddt1cj",
    });
  });

  it("decodes stable Core label errors without reimplementing Unicode rules", async () => {
    const runtime = generatedRuntime({
      derive_pub_dress_label: () => "error:disallowed_scalar",
    });
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => runtime,
    });

    expect(bindings.derivePubDressLabel?.("0x0a🌍")).toEqual({
      kind: "error",
      code: "disallowed_scalar",
    });
  });

  it("rejects malformed Core label wire results", async () => {
    const runtime = generatedRuntime({
      derive_pub_dress_label: () => "label:../unsafe",
    });
    const bindings = await loadGeneratedCoreWasmBindings({
      importRuntime: async () => runtime,
    });

    expect(() => bindings.derivePubDressLabel?.("0x0sky")).toThrow(
      "invalid PubDress label",
    );
  });

  it("rejects a generated runtime with a different corpus digest", async () => {
    const runtime = generatedRuntime({
      fixture_corpus_digest: () => "sha256_wrong",
    });

    await expect(
      loadGeneratedCoreWasmBindings({ importRuntime: async () => runtime }),
    ).rejects.toThrow("compatibility verification");
  });

  it("loads the generated runtime from a host-proxied base", async () => {
    const runtime = generatedRuntime();
    const importRuntime = vi.fn(async () => runtime);

    await loadGeneratedCoreWasmBindings({
      baseUrl: "/.proxy/core/0.1.0",
      importRuntime,
    });

    expect(importRuntime).toHaveBeenCalledWith("/.proxy/core/0.1.0/index.js");
    expect(runtime.default).toHaveBeenCalledWith({
      module_or_path: "/.proxy/core/0.1.0/index_bg.wasm",
    });
  });
});
