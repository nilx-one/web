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
 * The lifecycle underneath — probe, worker, cache, eviction — is `@aiaiaiai/webllm`'s. What
 * this package adds is narration's own: the prompt, the bound on a pass, and the check that
 * a rephrasing carries only what it was given.
 */

import {
  admitFragments,
  type CellEvidence,
  type NarrationAdapter,
  type NarrationCapability,
  type NarrationFragment,
  type NarrationUnavailableReason,
} from "@nilx-one/narration-contract";

import type { DeviceVerdict } from "./device";

export { deviceVerdict, RUNTIME_DEVICE_FLOORS } from "./device";
export type { DeviceVerdict, RuntimeDeviceLimit } from "./device";

const ADAPTER_ID = "webllm-local";

/** The catalog entry `nilx-one/ai` selects for this product. */
export const NARRATION_MODEL_ID = "Qwen3-0.6B-q4f16_1-MLC";

/** A sentence longer than this is not a rephrasing of one line of evidence. */
const MAX_SENTENCE_LENGTH = 180;

export interface LoadProgress {
  readonly ratio: number;
  readonly text: string;
}

/** The engine surface this adapter needs, kept injectable so tests need no GPU. */
export interface LocalEngine {
  rephrase(system: string, user: string): Promise<string>;
  unload(): Promise<void>;
}

/** The browser boundary: everything that touches WebGPU, the network, or the cache. */
export interface WebLlmRuntimeHost {
  inspect(): Promise<DeviceVerdict>;
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
  readonly modelId?: string;
  /** Most records one pass will narrate. The rest keep their deterministic sentence. */
  readonly maxRecords?: number;
  readonly onProgress?: (progress: LoadProgress) => void;
}

export interface WebLlmNarrationAdapter extends NarrationAdapter {
  /** Whether the artifacts are already on this device. Never downloads. */
  cached(): Promise<boolean>;
}

const SYSTEM_PROMPT = [
  "Ти переказуєш один рядок особистого журналу присутності українською.",
  "Дозволено лише переформулювати надане речення: час, тривалість і те, що людина була тут.",
  "Заборонено додавати місця, причини, маршрут, погоду, настрій та інших людей.",
  "Заборонено вигадувати або змінювати числа.",
  "Відповідай одним коротким реченням і нічим більше.",
].join(" ");

/**
 * Creates the local-model adapter. Construction touches nothing: no probe, no download.
 */
export function createWebLlmNarrationAdapter(
  options: WebLlmNarrationOptions,
): WebLlmNarrationAdapter {
  const modelId = options.modelId ?? NARRATION_MODEL_ID;
  const maxRecords = options.maxRecords ?? 24;

  return {
    id: ADAPTER_ID,

    async capability(): Promise<NarrationCapability> {
      const verdict = await options.host.inspect();
      return verdict.kind === "usable"
        ? { kind: "ready", adapter: ADAPTER_ID }
        : {
            kind: "unavailable",
            adapter: ADAPTER_ID,
            reason: reasonFor(verdict),
          };
    },

    cached(): Promise<boolean> {
      return options.host.isCached(modelId);
    },

    async narrate(
      evidence: readonly CellEvidence[],
    ): Promise<readonly NarrationFragment[]> {
      const deterministic = await options.base.narrate(evidence);

      const verdict = await options.host.inspect();
      if (verdict.kind !== "usable" || deterministic.length === 0) {
        // Deterministic narration is the product on this surface, not a degraded form of
        // one. Which adapter spoke is readable from `capability()`, never inferred from
        // the sentences.
        return deterministic;
      }

      let engine: LocalEngine | undefined;
      try {
        engine = await options.host.open(modelId, (progress) =>
          options.onProgress?.(progress),
        );

        const rephrased: NarrationFragment[] = [];
        for (const fragment of deterministic) {
          rephrased.push(
            rephrased.length >= maxRecords
              ? fragment
              : await rephraseOne(engine, fragment),
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

async function rephraseOne(
  engine: LocalEngine,
  fragment: NarrationFragment,
): Promise<NarrationFragment> {
  const said = (await engine.rephrase(SYSTEM_PROMPT, fragment.text)).trim();

  return isFaithful(said, fragment.text)
    ? { cell: fragment.cell, at: fragment.at, text: said }
    : fragment;
}

/**
 * Whether a rephrasing carries only what it was given.
 *
 * The concrete way this model invents is numeric: a time that was never recorded, a
 * duration rounded into a different one, a count of visits nobody made. So every digit
 * sequence in the sentence must already appear in the sentence it rephrased. It is a narrow
 * test and a cheap one, and it fails closed — a sentence that does not pass is replaced by
 * the deterministic one rather than corrected.
 */
function isFaithful(said: string, source: string): boolean {
  if (said === "" || said.length > MAX_SENTENCE_LENGTH) {
    return false;
  }
  const allowed = new Set(source.match(/\d+/g) ?? []);
  return (said.match(/\d+/g) ?? []).every((number) => allowed.has(number));
}

function reasonFor(verdict: DeviceVerdict): NarrationUnavailableReason {
  switch (verdict.kind) {
    case "insecure_context":
    case "webgpu_missing":
    case "adapter_unavailable":
    case "below_runtime_floor":
    case "missing_features":
      return "surface_unsupported";
    default:
      return "not_loaded";
  }
}
