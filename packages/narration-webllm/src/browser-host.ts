// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The browser half of local narration: WebGPU, the network, the cache, the worker.
 *
 * Everything that can download, occupy memory, or fail because of a device lives here and
 * nowhere else, so the adapter above it stays testable without a GPU.
 */

import {
  CreateWebWorkerMLCEngine,
  hasModelInCache,
  prebuiltAppConfig,
  type AppConfig,
  type InitProgressReport,
  type ModelRecord,
} from "@mlc-ai/web-llm";

import { inspectDevice, type DeviceVerdict } from "./device";
import {
  NARRATION_MODEL_ID,
  type LoadProgress,
  type LocalEngine,
  type WebLlmRuntimeHost,
} from "./index";

/** One short rephrasing. Bounded because a sentence is all that is wanted. */
const MAX_NEW_TOKENS = 48;
const TEMPERATURE = 0.3;
const TOP_P = 0.9;

export interface BrowserHostOptions {
  readonly modelId?: string;
  /** Overrides the registry entry. A mirror supplies its own origin here. */
  readonly appConfig?: AppConfig;
  readonly workerFactory?: () => Worker;
}

/**
 * Builds the app config this product loads under.
 *
 * Two things the prebuilt registry does not do for us. It omits `required_features` on the
 * newer entries, so a device without `shader-f16` would download an entire model before
 * failing to initialise it — we declare it. And its default cache backend is the Cache API,
 * while artifacts meant to stay through eviction pressure belong in OPFS where the browser
 * offers it.
 */
export function narrationAppConfig(modelId = NARRATION_MODEL_ID): AppConfig {
  const model_list = prebuiltAppConfig.model_list.map((record: ModelRecord) =>
    record.model_id === modelId
      ? {
          ...record,
          required_features: record.required_features ?? ["shader-f16"],
        }
      : record,
  );

  return {
    model_list,
    cacheBackend: supportsOpfs() ? "opfs" : "cache",
  };
}

function supportsOpfs(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof (navigator.storage as { getDirectory?: unknown } | undefined)
      ?.getDirectory === "function"
  );
}

/**
 * Describes the download before anything starts.
 *
 * This performs exactly one request, for the artifact manifest, because the honest size of
 * a model is the sum of its shards and no constant in this repository knows it. A product
 * must be able to say how many bytes it is about to ask for; a product that cannot reach
 * the manifest says so rather than guessing.
 */
export async function describeDownload(
  modelId = NARRATION_MODEL_ID,
  appConfig: AppConfig = narrationAppConfig(modelId),
  fetchImpl: typeof fetch = fetch,
): Promise<
  { readonly bytes: number } | { readonly bytes: null; readonly reason: string }
> {
  const record = appConfig.model_list.find(
    (entry) => entry.model_id === modelId,
  );
  if (record === undefined) {
    return { bytes: null, reason: "model_not_in_config" };
  }

  try {
    const response = await fetchImpl(
      new URL("ndarray-cache.json", modelUrl(record.model)),
    );
    if (!response.ok) {
      return { bytes: null, reason: `manifest_http_${response.status}` };
    }
    const manifest = (await response.json()) as {
      records?: readonly { nbytes?: number }[];
    };
    const bytes = (manifest.records ?? []).reduce(
      (total, shard) => total + (shard.nbytes ?? 0),
      0,
    );
    return bytes > 0
      ? { bytes }
      : { bytes: null, reason: "manifest_without_sizes" };
  } catch {
    return { bytes: null, reason: "manifest_unreachable" };
  }
}

/**
 * WebLLM appends `resolve/main/` to any model URL that does not already name a revision, so
 * a mirror served from `…/resolve/<revision>/` is left alone and a bare path is not.
 */
function modelUrl(model: string): string {
  const withSlash = model.endsWith("/") ? model : `${model}/`;
  const segments = withSlash.split("/");
  const resolveIndex = segments.lastIndexOf("resolve");
  const namesRevision =
    resolveIndex >= 0 &&
    resolveIndex + 1 < segments.length - 1 &&
    segments[resolveIndex + 1] !== "";

  return namesRevision ? withSlash : `${withSlash}resolve/main/`;
}

/** The production host. Construction downloads nothing and starts no worker. */
export function createBrowserHost(
  options: BrowserHostOptions = {},
): WebLlmRuntimeHost {
  const modelId = options.modelId ?? NARRATION_MODEL_ID;
  const appConfig = options.appConfig ?? narrationAppConfig(modelId);
  const workerFactory =
    options.workerFactory ??
    (() =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }));

  return {
    inspect(): Promise<DeviceVerdict> {
      return inspectDevice();
    },

    isCached(id: string): Promise<boolean> {
      // Asked with the same config the load will use: a query against another registry or
      // another backend answers about a different place than the one being filled.
      return hasModelInCache(id, appConfig);
    },

    async open(
      id: string,
      onProgress: (progress: LoadProgress) => void,
    ): Promise<LocalEngine> {
      const worker = workerFactory();
      try {
        const engine = await CreateWebWorkerMLCEngine(worker, id, {
          appConfig,
          initProgressCallback: (report: InitProgressReport) =>
            onProgress({ ratio: report.progress, text: report.text }),
        });

        return {
          async rephrase(system: string, user: string): Promise<string> {
            const completion = await engine.chat.completions.create({
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
              stream: false,
              max_tokens: MAX_NEW_TOKENS,
              temperature: TEMPERATURE,
              top_p: TOP_P,
              extra_body: { enable_thinking: false },
            });
            return completion.choices[0]?.message.content ?? "";
          },

          async unload(): Promise<void> {
            try {
              await engine.unload();
            } finally {
              worker.terminate();
            }
          },
        };
      } catch (error) {
        worker.terminate();
        throw error;
      }
    },
  };
}
