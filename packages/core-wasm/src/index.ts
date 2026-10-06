// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreCarry,
  CoreCraftedItem,
  CoreEconomyCatalog,
  CoreFindItemResult,
  CoreFoundItem,
  CoreInventoryAnswer,
  CoreInventoryCommand,
  CoreRecipe,
  CoreSize,
  CorePubDressLabelErrorCode,
  CorePubDressLabelResult,
  CoreRuntimePort,
  CoreRuntimeStatus,
} from "@nilx-one/application";

export const CORE_CONTRACT_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_VERSION = "0.1.0";
export const CORE_FIXTURE_CORPUS_DIGEST =
  "sha256_d8524ee7a22aa07164362afb4098cf37404f61ab45fcfd48aab2de2fe9016009";

/**
 * Where the verified Core runtime is published. A host that proxies the
 * client's own origin re-roots this base rather than republishing the artifact.
 */
export const CORE_RUNTIME_BASE_URL = `/core/${CORE_CONTRACT_VERSION}`;

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

/** Core's catalog ids and error codes: lowercase words joined by `_`. */
const CORE_CODE = /^[a-z][a-z_]*$/;

function decodeFindItemWire(value: string): CoreFindItemResult {
  for (const kind of ["item", "error"] as const) {
    const prefix = `${kind}:`;
    if (!value.startsWith(prefix)) continue;
    const rest = value.slice(prefix.length);
    if (!CORE_CODE.test(rest)) break;
    return kind === "item" ? { kind, id: rest } : { kind, code: rest };
  }
  throw new Error("0x1 Core returned an invalid find item");
}

function decodePicksUpWire(value: string): boolean {
  if (value === "yes") return true;
  if (value === "no") return false;
  throw new Error(`0x1 Core refused the pick-up setting: ${value}`);
}

const RARITIES = new Set(["common", "uncommon", "rare", "legendary"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function decodeFoundItem(value: unknown): CoreFoundItem {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    CORE_CODE.test(value.id) &&
    isCount(value.tier) &&
    value.tier >= 1 &&
    value.tier <= 6 &&
    typeof value.rarity === "string" &&
    RARITIES.has(value.rarity) &&
    isCount(value.experience)
  ) {
    return {
      id: value.id,
      tier: value.tier,
      rarity: value.rarity as CoreFoundItem["rarity"],
      experience: value.experience,
      seeds: decodeAmount(value.seeds),
      sellPrice: decodePrice(value.sell_price),
      size: decodeSize(value.size),
    };
  }
  throw new Error("0x1 Core returned an invalid catalog item");
}

/** Core's u64 wire form: a canonical decimal string, within JS's safe range. */
function decodeAmount(value: unknown): number {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const amount = Number(value);
    if (Number.isSafeInteger(amount)) return amount;
  }
  throw new Error("0x1 Core returned an invalid amount");
}

function decodePrice(value: unknown): number | null {
  return value === null || value === undefined ? null : decodeAmount(value);
}

function decodeSize(value: unknown): CoreSize | null {
  if (value === null || value === undefined) return null;
  if (
    isRecord(value) &&
    isCount(value.width) &&
    isCount(value.height) &&
    value.width > 0 &&
    value.height > 0
  ) {
    return { width: value.width, height: value.height };
  }
  throw new Error("0x1 Core returned an invalid size");
}

function decodeCrafted(value: unknown): CoreCraftedItem {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    CORE_CODE.test(value.id)
  ) {
    return {
      id: value.id,
      sellPrice: decodePrice(value.sell_price),
      size: decodeSize(value.size),
    };
  }
  throw new Error("0x1 Core returned an invalid crafted item");
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && CORE_CODE.test(value);
}

function decodeRecipe(value: unknown): CoreRecipe {
  if (
    isRecord(value) &&
    isCode(value.id) &&
    Array.isArray(value.consumes) &&
    Array.isArray(value.tools) &&
    value.tools.every(isCode) &&
    isCode(value.makes) &&
    isCount(value.experience) &&
    (value.place === "anywhere" || value.place === "repair_workshop") &&
    isCount(value.minutes) &&
    typeof value.legendary === "boolean"
  ) {
    return {
      id: value.id,
      consumes: value.consumes.map((input: unknown) => {
        if (isRecord(input) && isCode(input.id) && isCount(input.count)) {
          return { id: input.id, count: input.count };
        }
        throw new Error("0x1 Core returned an invalid recipe input");
      }),
      tools: value.tools,
      seeds: decodeAmount(value.seeds),
      makes: value.makes,
      experience: value.experience,
      place: value.place,
      minutes: value.minutes,
      legendary: value.legendary,
    };
  }
  throw new Error("0x1 Core returned an invalid recipe");
}

const CARRIES = new Set(["pocket", "backpack", "bag"]);

function decodeCarry(value: unknown): CoreCarry {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    CARRIES.has(value.id)
  ) {
    const size = decodeSize(value);
    if (size !== null) {
      return { id: value.id as CoreCarry["id"], ...size };
    }
  }
  throw new Error("0x1 Core returned an invalid carry");
}

function decodeInventoryAnswer(value: string): CoreInventoryAnswer {
  const parsed: unknown = JSON.parse(value);
  if (
    isRecord(parsed) &&
    parsed.ok === false &&
    typeof parsed.error === "string"
  ) {
    return { ok: false, error: parsed.error };
  }
  if (
    isRecord(parsed) &&
    parsed.ok === true &&
    isRecord(parsed.state) &&
    isRecord(parsed.outcome) &&
    isCount(parsed.outcome.experience) &&
    (parsed.item === undefined ||
      (typeof parsed.item === "string" && CORE_CODE.test(parsed.item)))
  ) {
    return {
      ok: true,
      state: JSON.stringify(parsed.state),
      seedsGained: decodeAmount(parsed.outcome.seeds_gained),
      seedsSpent: decodeAmount(parsed.outcome.seeds_spent),
      experience: parsed.outcome.experience,
      ...(parsed.item === undefined ? {} : { item: parsed.item }),
    };
  }
  throw new Error("0x1 Core returned an invalid inventory answer");
}

function decodeEconomyCatalog(value: string): CoreEconomyCatalog {
  const parsed: unknown = JSON.parse(value);
  if (
    isRecord(parsed) &&
    isCount(parsed.find_catalog_version) &&
    isCount(parsed.economy_version) &&
    isRecord(parsed.currency) &&
    typeof parsed.currency.code === "string" &&
    typeof parsed.currency.emblem === "string" &&
    Array.isArray(parsed.found)
  ) {
    return {
      findCatalogVersion: parsed.find_catalog_version,
      economyVersion: parsed.economy_version,
      currency: {
        code: parsed.currency.code,
        emblem: parsed.currency.emblem,
      },
      found: parsed.found.map(decodeFoundItem),
      crafted: Array.isArray(parsed.crafted)
        ? parsed.crafted.map(decodeCrafted)
        : [],
      recipes: Array.isArray(parsed.recipes)
        ? parsed.recipes.map(decodeRecipe)
        : [],
      carries: Array.isArray(parsed.carries)
        ? parsed.carries.map(decodeCarry)
        : [],
    };
  }
  throw new Error("0x1 Core returned an invalid economy catalog");
}

export interface CoreWasmBindings {
  contractVersion(): string;
  findItem?(artifactId: string, tier: number): CoreFindItemResult;
  picksUp?(rarities: string, tier: number): boolean;
  economyCatalog?(): CoreEconomyCatalog;
  applyInventoryCommand?(
    state: string,
    command: CoreInventoryCommand,
    nowMs: number,
  ): CoreInventoryAnswer;
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
  /** Absent from a runtime built before Core's find catalog. */
  find_item?(artifact_id: string, tier: number): string;
  picks_up?(rarities: string, tier: number): string;
  economy_catalog?(): string;
  apply_inventory_command?(
    state: string,
    command: string,
    now_ms: string,
  ): string;
}

export type CoreWasmBindingsLoader = () => Promise<CoreWasmBindings>;
export type CoreWasmRuntimeImporter = (
  moduleUrl: string,
) => Promise<GeneratedCoreWasmModule>;

export interface GeneratedCoreWasmBindingsOptions {
  /** The published runtime base, overridden only by a host that proxies it. */
  readonly baseUrl?: string;
  readonly importRuntime?: CoreWasmRuntimeImporter;
}

export interface CoreWasmClientOptions {
  loadBindings?: CoreWasmBindingsLoader;
}

async function importGeneratedCoreWasmRuntime(
  moduleUrl: string,
): Promise<GeneratedCoreWasmModule> {
  return (await import(
    /* @vite-ignore */ moduleUrl
  )) as GeneratedCoreWasmModule;
}

export async function loadGeneratedCoreWasmBindings(
  options: GeneratedCoreWasmBindingsOptions = {},
): Promise<CoreWasmBindings> {
  const baseUrl = options.baseUrl ?? CORE_RUNTIME_BASE_URL;
  const importRuntime = options.importRuntime ?? importGeneratedCoreWasmRuntime;
  const runtime = await importRuntime(`${baseUrl}/index.js`);
  await runtime.default({ module_or_path: `${baseUrl}/index_bg.wasm` });

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
    ...(runtime.find_item === undefined || runtime.picks_up === undefined
      ? {}
      : {
          findItem: (artifactId: string, tier: number) =>
            decodeFindItemWire(runtime.find_item!(artifactId, tier)),
          picksUp: (rarities: string, tier: number) =>
            decodePicksUpWire(runtime.picks_up!(rarities, tier)),
        }),
    ...(runtime.economy_catalog === undefined
      ? {}
      : {
          economyCatalog: () =>
            decodeEconomyCatalog(runtime.economy_catalog!()),
        }),
    ...(runtime.apply_inventory_command === undefined
      ? {}
      : {
          applyInventoryCommand: (
            state: string,
            command: CoreInventoryCommand,
            nowMs: number,
          ) => {
            if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
              throw new RangeError("now must be a whole number of ms");
            }
            return decodeInventoryAnswer(
              runtime.apply_inventory_command!(
                state,
                JSON.stringify(command),
                String(nowMs),
              ),
            );
          },
        }),
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

  public async findItem(
    artifactId: string,
    tier: number,
  ): Promise<CoreFindItemResult> {
    const bindings = await this.loadBindings();
    if (bindings.findItem === undefined) {
      throw new Error("0x1 Core Wasm find catalog binding is missing");
    }
    return bindings.findItem(artifactId, tier);
  }

  public async economyCatalog(): Promise<CoreEconomyCatalog> {
    const bindings = await this.loadBindings();
    if (bindings.economyCatalog === undefined) {
      throw new Error("0x1 Core Wasm economy catalog binding is missing");
    }
    return bindings.economyCatalog();
  }

  public async applyInventoryCommand(
    state: string,
    command: CoreInventoryCommand,
    nowMs: number,
  ): Promise<CoreInventoryAnswer> {
    const bindings = await this.loadBindings();
    if (bindings.applyInventoryCommand === undefined) {
      throw new Error("0x1 Core Wasm inventory binding is missing");
    }
    return bindings.applyInventoryCommand(state, command, nowMs);
  }

  public async picksUp(rarities: string, tier: number): Promise<boolean> {
    const bindings = await this.loadBindings();
    if (bindings.picksUp === undefined) {
      throw new Error("0x1 Core Wasm pick-up binding is missing");
    }
    return bindings.picksUp(rarities, tier);
  }
}

export function createCoreWasmClient(
  options: CoreWasmClientOptions = {},
): CoreRuntimePort {
  return new CoreWasmClient(options);
}
