// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreRuntimePort, CoreRuntimeStatus } from "@nilx-one/application";

export const CORE_CONTRACT_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_DIGEST =
  "sha256_d8524ee7a22aa07164362afb4098cf37404f61ab45fcfd48aab2de2fe9016009";

const CORE_RUNTIME_BASE_URL = `/core/${CORE_CONTRACT_VERSION}`;
const CORE_RUNTIME_MODULE_URL = `${CORE_RUNTIME_BASE_URL}/index.js`;
const CORE_RUNTIME_WASM_URL = `${CORE_RUNTIME_BASE_URL}/index_bg.wasm`;

export interface CoreWasmBindings {
  contractVersion(): string;
}

export interface GeneratedCoreWasmModule {
  default(input: { module_or_path: string }): Promise<unknown>;
  contract_version(): string;
  fixture_corpus_version(): string;
  fixture_corpus_digest(): string;
}

export type CoreWasmBindingsLoader = () => Promise<CoreWasmBindings>;
export type CoreWasmRuntimeImporter = () => Promise<GeneratedCoreWasmModule>;

export interface CoreWasmClientOptions {
  loadBindings?: CoreWasmBindingsLoader;
}

async function importGeneratedCoreWasmRuntime(): Promise<GeneratedCoreWasmModule> {
  return (await import(/* @vite-ignore */ CORE_RUNTIME_MODULE_URL)) as GeneratedCoreWasmModule;
}

export async function loadGeneratedCoreWasmBindings(
  importRuntime: CoreWasmRuntimeImporter = importGeneratedCoreWasmRuntime,
): Promise<CoreWasmBindings> {
  const runtime = await importRuntime();
  await runtime.default({ module_or_path: CORE_RUNTIME_WASM_URL });

  const contractVersion = runtime.contract_version();
  const fixtureCorpusVersion = runtime.fixture_corpus_version();
  const fixtureCorpusDigest = runtime.fixture_corpus_digest();

  if (
    contractVersion !== CORE_CONTRACT_VERSION ||
    fixtureCorpusVersion !== CORE_FIXTURE_CORPUS_VERSION ||
    fixtureCorpusDigest !== CORE_FIXTURE_CORPUS_DIGEST
  ) {
    throw new Error("0x1 Core Wasm runtime failed compatibility verification");
  }

  return {
    contractVersion: () => contractVersion,
  };
}

class CoreWasmClient implements CoreRuntimePort {
  public constructor(private readonly options: CoreWasmClientOptions) {}

  public async probe(): Promise<CoreRuntimeStatus> {
    if (this.options.loadBindings === undefined) {
      return {
        kind: "unavailable",
        reason: "artifact-missing",
      };
    }

    try {
      const bindings = await this.options.loadBindings();
      const contractVersion = bindings.contractVersion().trim();

      if (contractVersion.length === 0) {
        return {
          kind: "unavailable",
          reason: "binding-invalid",
        };
      }

      return {
        kind: "ready",
        contractVersion,
      };
    } catch {
      return {
        kind: "unavailable",
        reason: "load-failed",
      };
    }
  }
}

export function createCoreWasmClient(
  options: CoreWasmClientOptions = {},
): CoreRuntimePort {
  return new CoreWasmClient(options);
}
