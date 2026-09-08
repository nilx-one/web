// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CorePubDressLabelErrorCode,
  CorePubDressLabelResult,
  CoreRuntimePort,
  CoreRuntimeStatus,
} from "@nilx-one/application";

export const CORE_CONTRACT_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_DIGEST =
  "sha256_d8524ee7a22aa07164362afb4098cf37404f61ab45fcfd48aab2de2fe9016009";

const CORE_RUNTIME_BASE_URL = `/core/${CORE_CONTRACT_VERSION}`;
const CORE_RUNTIME_MODULE_URL = `${CORE_RUNTIME_BASE_URL}/index.js`;
const CORE_RUNTIME_WASM_URL = `${CORE_RUNTIME_BASE_URL}/index_bg.wasm`;

const PUB_DRESS_LABEL_ERROR_CODES = new Set<CorePubDressLabelErrorCode>([
  "not_a_pub_dress",
  "invalid_character",
  "disallowed_scalar",
  "bidi_rule",
  "not_encodable",
  "boundary_hyphen",
  "too_long",
  "suffix_too_long",
]);

function decodePubDressLabelWire(value: string): CorePubDressLabelResult {
  if (value.startsWith("label:")) {
    const label = value.slice("label:".length);
    if (
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9-]+$/.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
    ) {
      return { kind: "label", label };
    }
    throw new Error("0x1 Core returned an invalid PubDress label");
  }

  if (value.startsWith("error:")) {
    const code = value.slice("error:".length) as CorePubDressLabelErrorCode;
    if (PUB_DRESS_LABEL_ERROR_CODES.has(code)) {
      return { kind: "error", code };
    }
  }

  throw new Error("0x1 Core returned an invalid PubDress label result");
}

export interface CoreWasmBindings {
  contractVersion(): string;
  derivePubDressLabel?(pubDress: string): CorePubDressLabelResult;
  composePubDressLabel?(
    pubDress: string,
    suffix: string,
  ): CorePubDressLabelResult;
}

export interface GeneratedCoreWasmModule {
  default(input: { module_or_path: string }): Promise<unknown>;
  contract_version(): string;
  fixture_corpus_version(): string;
  fixture_corpus_digest(): string;
  derive_pub_dress_label(value: string): string;
  compose_pub_dress_label(value: string, suffix: string): string;
  pub_dress_unicode_version(): string;
  pub_dress_uts46_implementation(): string;
  validate_pub_dress(value: string): string;
}

export type CoreWasmBindingsLoader = () => Promise<CoreWasmBindings>;
export type CoreWasmRuntimeImporter = () => Promise<GeneratedCoreWasmModule>;

export interface CoreWasmClientOptions {
  loadBindings?: CoreWasmBindingsLoader;
}

async function importGeneratedCoreWasmRuntime(): Promise<GeneratedCoreWasmModule> {
  return (await import(
    /* @vite-ignore */ CORE_RUNTIME_MODULE_URL
  )) as GeneratedCoreWasmModule;
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
    derivePubDressLabel: (pubDress) =>
      decodePubDressLabelWire(runtime.derive_pub_dress_label(pubDress)),
    composePubDressLabel: (pubDress, suffix) =>
      decodePubDressLabelWire(
        runtime.compose_pub_dress_label(pubDress, suffix),
      ),
  };
}

class CoreWasmClient implements CoreRuntimePort {
  private bindingsPromise: Promise<CoreWasmBindings> | undefined;

  public constructor(private readonly options: CoreWasmClientOptions) {}

  private loadBindings(): Promise<CoreWasmBindings> {
    if (this.options.loadBindings === undefined) {
      return Promise.reject(new Error("0x1 Core Wasm artifact is missing"));
    }
    this.bindingsPromise ??= this.options.loadBindings();
    return this.bindingsPromise;
  }

  public async probe(): Promise<CoreRuntimeStatus> {
    if (this.options.loadBindings === undefined) {
      return {
        kind: "unavailable",
        reason: "artifact-missing",
      };
    }

    try {
      const bindings = await this.loadBindings();
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

  public async derivePubDressLabel(
    pubDress: string,
  ): Promise<CorePubDressLabelResult> {
    const bindings = await this.loadBindings();
    if (bindings.derivePubDressLabel === undefined) {
      throw new Error("0x1 Core Wasm label derivation binding is missing");
    }
    return bindings.derivePubDressLabel(pubDress);
  }

  public async composePubDressLabel(
    pubDress: string,
    suffix: string,
  ): Promise<CorePubDressLabelResult> {
    const bindings = await this.loadBindings();
    if (bindings.composePubDressLabel === undefined) {
      throw new Error("0x1 Core Wasm label composition binding is missing");
    }
    return bindings.composePubDressLabel(pubDress, suffix);
  }
}

export function createCoreWasmClient(
  options: CoreWasmClientOptions = {},
): CoreRuntimePort {
  return new CoreWasmClient(options);
}
