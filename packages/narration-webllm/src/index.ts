// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Local model narration, behind the same contract the deterministic adapter serves.
 *
 * This adapter changes how narration reads and nothing else. It never produces a fact: for
 * every record it is given, the deterministic sentence is the ground truth, the model is
 * asked to say the same thing differently, and anything it returns that could be a new fact
 * is discarded in favour of the sentence it was rephrasing. Narration therefore never falls
 * below Phase 2, on any surface, in any failure.
 *
 * Its lifecycle is the one `nilx-one/ai#8` specifies: nothing is fetched until an explicit
 * call, the download is describable before it starts, artifacts are cached in the browser,
 * one bounded pass runs over the evidence, and the engine unloads afterwards. There is no
 * resident inference.
 *
 * Which model runs is the owner's choice within what this device admits, read at the moment
 * of narration — a choice changed in Settings after this adapter was composed is the one that
 * loads. A choice the device refuses falls back to the catalog's default, and a device that
 * admits neither narrates deterministically.
 *
 * The lifecycle underneath — probe, worker, cache, eviction — is `@aiaiaiai/webllm`'s. What
 * this package adds is narration's own: the catalog, a generation profile per family, the
 * prompt, the bound on a pass, and the check that a rephrasing carries only what it was given.
 */

import {
  admitFragments,
  type CellEvidence,
  type NarrationAdapter,
  type NarrationCapability,
  type NarrationFragment,
  type NarrationUnavailableReason,
} from "@nilx-one/narration-contract";

import {
  defaultLocalModel,
  findLocalModel,
  LOCAL_MODEL_CATALOG,
  type LocalModelCatalog,
  type LocalModelEntry,
} from "./catalog";
import type { DeviceVerdict } from "./device";
import { rephraseSentence, type LocalEngine } from "./rephrase";

export {
  defaultLocalModel,
  findLocalModel,
  LOCAL_MODEL_CATALOG,
  LocalModelCatalogError,
  MODEL_FAMILIES,
  parseLocalModelCatalog,
} from "./catalog";
export type {
  LocalModelCatalog,
  LocalModelEntry,
  MeasuredFaithfulness,
  ModelFamily,
} from "./catalog";
export { deviceVerdict, entryVerdict, RUNTIME_DEVICE_FLOORS } from "./device";
export type { DeviceVerdict, RuntimeDeviceLimit } from "./device";
export { FAITHFULNESS_FIXTURE, measureFaithfulness } from "./faithfulness";
export type { FaithfulnessCount } from "./faithfulness";
export {
  GENERATION_PROFILES,
  MAX_SENTENCE_LENGTH,
  tokenBoundFor,
  UKRAINIAN_TOKEN_DENSITY,
} from "./profiles";
export type { GenerationProfile, UkrainianTokenDensity } from "./profiles";
export type { LocalEngine, RephraseOptions } from "./rephrase";

const ADAPTER_ID = "webllm-local";

/** The catalog's default: the entry `nilx-one/ai` names for surfaces with nobody to ask. */
export const NARRATION_MODEL_ID: string = LOCAL_MODEL_CATALOG.defaultModelId;

export interface LoadProgress {
  readonly ratio: number;
  readonly text: string;
}

/** The browser boundary: everything that touches WebGPU, the network, or the cache. */
export interface WebLlmRuntimeHost {
  /** This device's verdict on one entry, including the budget its surface declared. */
  inspect(modelId: string): Promise<DeviceVerdict>;
  isCached(modelId: string): Promise<boolean>;
  /**
   * Downloads when the artifacts are not cached. Called only from `load`.
   *
   * `signal` abandons a download in progress; the promise then rejects with its reason.
   */
  open(
    modelId: string,
    onProgress: (progress: LoadProgress) => void,
    signal?: AbortSignal,
  ): Promise<LocalEngine>;
  /** Evicts a cached model an owner asked to reclaim, in full: config, weights, and library. */
  remove(modelId: string): Promise<void>;
}

export interface WebLlmNarrationOptions {
  /** The deterministic adapter. Its sentences are the facts this one rephrases. */
  readonly base: NarrationAdapter;
  readonly host: WebLlmRuntimeHost;
  /** The entries a choice is read against. Defaults to this product's catalog. */
  readonly catalog?: LocalModelCatalog;
  /**
   * The entry the owner chose, or how to read it. A function is read at the moment of
   * narration, so the choice Settings stores is the one that loads however long ago this
   * adapter was composed. Unset, unknown, or refused by this device means the default.
   */
  readonly modelId?: string | (() => string | undefined);
  /** Most records one pass will narrate. The rest keep their deterministic sentence. */
  readonly maxRecords?: number;
  readonly onProgress?: (progress: LoadProgress) => void;
}

export interface WebLlmNarrationAdapter extends NarrationAdapter {
  /** Whether the artifacts of the entry that would run are already on this device. Never downloads. */
  cached(): Promise<boolean>;
}

/**
 * Creates the local-model adapter. Construction touches nothing: no probe, no download.
 */
export function createWebLlmNarrationAdapter(
  options: WebLlmNarrationOptions,
): WebLlmNarrationAdapter {
  const catalog = options.catalog ?? LOCAL_MODEL_CATALOG;
  const fallback = defaultLocalModel(catalog);
  const maxRecords = options.maxRecords ?? 24;

  function chosenEntry(): LocalModelEntry {
    const choice =
      typeof options.modelId === "function"
        ? options.modelId()
        : options.modelId;
    return findLocalModel(catalog, choice) ?? fallback;
  }

  /** The chosen entry if this device admits it, else the default if it admits that. */
  async function runnable(): Promise<
    | { readonly entry: LocalModelEntry }
    | { readonly entry: undefined; readonly verdict: DeviceVerdict }
  > {
    const chosen = chosenEntry();
    const verdict = await options.host.inspect(chosen.modelId);
    if (verdict.kind === "usable") {
      return { entry: chosen };
    }
    if (chosen.modelId !== fallback.modelId) {
      const fallbackVerdict = await options.host.inspect(fallback.modelId);
      if (fallbackVerdict.kind === "usable") {
        return { entry: fallback };
      }
    }
    return { entry: undefined, verdict };
  }

  return {
    id: ADAPTER_ID,

    async capability(): Promise<NarrationCapability> {
      const resolved = await runnable();
      return resolved.entry !== undefined
        ? { kind: "ready", adapter: ADAPTER_ID }
        : {
            kind: "unavailable",
            adapter: ADAPTER_ID,
            reason: reasonFor(resolved.verdict),
          };
    },

    async cached(): Promise<boolean> {
      const resolved = await runnable();
      return options.host.isCached((resolved.entry ?? chosenEntry()).modelId);
    },

    async narrate(
      evidence: readonly CellEvidence[],
    ): Promise<readonly NarrationFragment[]> {
      const deterministic = await options.base.narrate(evidence);
      if (deterministic.length === 0) {
        return deterministic;
      }

      const { entry } = await runnable();
      if (entry === undefined) {
        // Deterministic narration is the product on this surface, not a degraded form of
        // one. Which adapter spoke is readable from `capability()`, never inferred from
        // the sentences.
        return deterministic;
      }

      let engine: LocalEngine | undefined;
      try {
        engine = await options.host.open(entry.modelId, (progress) =>
          options.onProgress?.(progress),
        );

        const rephrased: NarrationFragment[] = [];
        for (const fragment of deterministic) {
          rephrased.push(
            rephrased.length >= maxRecords
              ? fragment
              : await rephraseOne(engine, entry, fragment),
          );
        }
        // One bounded pass, checked against the evidence it came from before anyone sees it.
        return admitFragments(evidence, rephrased).fragments;
      } catch {
        // A model that could not load or could not speak took nothing with it.
        return deterministic;
      } finally {
        // Unload by default: this product has no resident inference.
        await engine?.unload().catch(() => undefined);
      }
    },
  };
}

/**
 * Only text the model wrote carries the model's name and licence. A refused rephrasing keeps
 * the deterministic sentence as it was, because no model wrote it.
 */
async function rephraseOne(
  engine: LocalEngine,
  entry: LocalModelEntry,
  fragment: NarrationFragment,
): Promise<NarrationFragment> {
  const said = await rephraseSentence(engine, entry.family, fragment.text);
  return said === undefined
    ? fragment
    : {
        cell: fragment.cell,
        at: fragment.at,
        text: said,
        producedBy: {
          adapter: ADAPTER_ID,
          modelId: entry.modelId,
          licence: entry.licence,
        },
      };
}

function reasonFor(verdict: DeviceVerdict): NarrationUnavailableReason {
  switch (verdict.kind) {
    case "insecure_context":
    case "webgpu_missing":
    case "adapter_unavailable":
    case "below_runtime_floor":
    case "missing_features":
    case "over_budget":
      return "surface_unsupported";
    default:
      return "not_loaded";
  }
}
