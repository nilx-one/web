// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The browser half of local narration: WebGPU, the network, the cache, the worker.
 *
 * Everything that can download, occupy memory, or fail because of a device lives here and
 * nowhere else, so the adapter above it stays testable without a GPU.
 *
 * The lifecycle itself — probing, the engine behind a worker, the cache, eviction, and
 * abandoning a download midway — is `@aiaiaiai/webllm`'s. What stays here is this
 * product's: which model, which source it prefers, and how the size of a download is told
 * to a person before it starts.
 */

import {
  completedPrebuiltAppConfig,
  WebLlmBrowserHost,
  type LocalTextEngine,
  type ServedCatalog,
  type WebLlmBrowserHostOptions,
} from "@aiaiaiai/webllm";

import { deviceVerdict, type DeviceVerdict } from "./device";
import {
  NARRATION_MODEL_ID,
  type LoadProgress,
  type LocalEngine,
  type WebLlmRuntimeHost,
} from "./index";
import {
  describeMirrorDownload,
  loadMirrorManifest,
  mirrorCatalog,
  type MirrorManifest,
} from "./mirror";

/** The pinned runtime's configuration, named through the foundation rather than beside it. */
export type AppConfig = NonNullable<WebLlmBrowserHostOptions["appConfig"]>;

/** One short rephrasing. Bounded because a sentence is all that is wanted. */
const MAX_NEW_TOKENS = 48;
const TEMPERATURE = 0.3;
const TOP_P = 0.9;

export interface BrowserHostOptions {
  readonly modelId?: string;
  /**
   * Overrides both the mirror lookup and the upstream fallback outright. Set this only when
   * the caller has already resolved a source itself; leaving it unset is what lets a host
   * prefer this deployment's mirror over the pinned registry.
   */
  readonly appConfig?: AppConfig;
  readonly workerFactory?: () => Worker;
  /** Where a mirror manifest is read from. Defaults to this page's own origin. */
  readonly origin?: string;
  readonly revision?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Builds the app config this product loads from upstream under.
 *
 * The foundation already completes `required_features` on the registry entries that omit
 * it, so a device without `shader-f16` is refused before a download rather than after one.
 * What it leaves to a product is where the artifacts are kept: the default is the Cache
 * API, while artifacts meant to stay through eviction pressure belong in OPFS where the
 * browser offers it.
 */
export function narrationAppConfig(): AppConfig {
  return {
    ...completedPrebuiltAppConfig(),
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

/** The revision `bootstrap-models.sh` writes until this product rolls one forward. */
const DEFAULT_MIRROR_REVISION = "1";

export type ResolvedModelSource =
  | {
      readonly kind: "mirror";
      readonly catalog: ServedCatalog;
      readonly manifest: MirrorManifest;
    }
  | { readonly kind: "upstream"; readonly appConfig: AppConfig };

/**
 * Chooses where this device loads a model from: our own mirror when this deployment has
 * one, the pinned upstream registry otherwise. A mirror is preferred because it is the only
 * one of the two that names an immutable `model_lib` and keeps a device's IP off a host we do
 * not run — see `docs/model-selection.md` in `nilx-one/ai` for why that gap exists upstream.
 *
 * A malformed manifest is treated the same as a missing one: `mirrorCatalog` throwing is
 * this deployment describing a mirror it — or the foundation — does not trust, not a reason
 * to load from it anyway with a config nobody checked.
 */
export async function resolveLocalModelSource(
  modelId = NARRATION_MODEL_ID,
  origin: string = defaultOrigin(),
  revision = DEFAULT_MIRROR_REVISION,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedModelSource> {
  const manifest = await loadMirrorManifest(
    origin,
    modelId,
    revision,
    fetchImpl,
  );
  if (manifest !== null) {
    try {
      return {
        kind: "mirror",
        catalog: mirrorCatalog(origin, manifest),
        manifest,
      };
    } catch {
      // Falls through to upstream below.
    }
  }
  return { kind: "upstream", appConfig: narrationAppConfig() };
}

function defaultOrigin(): string {
  return typeof location === "undefined" ? "" : location.origin;
}

/**
 * The download size and provenance, answered without loading anything.
 *
 * A mirror states its size in the manifest this client already fetched to resolve the
 * source, so no second request is needed. The upstream path has no such manifest to read, so
 * it falls back to `describeDownload`'s own request against the registry entry it resolved.
 */
export async function describeLocalModelDownload(
  modelId = NARRATION_MODEL_ID,
  origin: string = defaultOrigin(),
  revision = DEFAULT_MIRROR_REVISION,
  fetchImpl: typeof fetch = fetch,
): Promise<
  | {
      readonly bytes: number;
      readonly source: "mirror" | "upstream";
      readonly notices: readonly string[];
    }
  | {
      readonly bytes: null;
      readonly reason: string;
      readonly source: "mirror" | "upstream";
    }
> {
  const resolved = await resolveLocalModelSource(
    modelId,
    origin,
    revision,
    fetchImpl,
  );
  if (resolved.kind === "mirror") {
    return {
      ...describeMirrorDownload(resolved.manifest),
      source: "mirror",
      notices: resolved.manifest.notices ?? [],
    };
  }
  const upstream = await describeDownload(
    modelId,
    resolved.appConfig,
    fetchImpl,
  );
  return upstream.bytes === null
    ? { bytes: null, reason: upstream.reason, source: "upstream" }
    : { bytes: upstream.bytes, source: "upstream", notices: [] };
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
  appConfig: AppConfig = narrationAppConfig(),
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
  // Left unset, the foundation starts the worker it ships, which runs the same pinned
  // runtime its host drives. A second copy here would be a second 6 MB bundle.
  const workerFactory = options.workerFactory;

  // Probing reads the adapter and nothing else, so it needs no source resolved — a device
  // that can run nothing is told so without a request to anyone. Its host is given an empty
  // model list because it will never be asked to load one.
  let probeHost: WebLlmBrowserHost | undefined;

  // Resolved lazily, and only once per host: construction must still download nothing, and
  // `isCached`, `open` and `remove` have to agree on the same source or they answer about
  // two places.
  let resolved: Promise<WebLlmBrowserHost> | undefined;
  function hostOptions(
    source: Pick<WebLlmBrowserHostOptions, "appConfig" | "catalog">,
  ): WebLlmBrowserHostOptions {
    return workerFactory === undefined ? source : { ...source, workerFactory };
  }
  function resolveHost(): Promise<WebLlmBrowserHost> {
    resolved ??=
      options.appConfig !== undefined
        ? Promise.resolve(
            new WebLlmBrowserHost(
              hostOptions({ appConfig: options.appConfig }),
            ),
          )
        : resolveLocalModelSource(
            modelId,
            options.origin,
            options.revision,
            options.fetchImpl,
          ).then((source) =>
            source.kind === "mirror"
              ? new WebLlmBrowserHost(hostOptions({ catalog: source.catalog }))
              : new WebLlmBrowserHost(
                  hostOptions({ appConfig: source.appConfig }),
                ),
          );
    return resolved;
  }

  return {
    async inspect(): Promise<DeviceVerdict> {
      probeHost ??= new WebLlmBrowserHost({ appConfig: { model_list: [] } });
      return deviceVerdict(await probeHost.probeWebGpu(), modelId);
    },

    async isCached(id: string): Promise<boolean> {
      return (await resolveHost()).hasModelInCache(id);
    },

    async remove(id: string): Promise<void> {
      await (await resolveHost()).evictModel(id);
    },

    async open(
      id: string,
      onProgress: (progress: LoadProgress) => void,
      signal?: AbortSignal,
    ): Promise<LocalEngine> {
      const host = await resolveHost();
      const engine = await host.createEngine(
        id,
        (progress) =>
          onProgress({ ratio: progress.progress, text: progress.text }),
        signal,
      );
      return {
        rephrase: (system, user) => complete(engine, system, user),
        unload: () => engine.unload(),
      };
    },
  };
}

async function complete(
  engine: LocalTextEngine,
  system: string,
  user: string,
): Promise<string> {
  let said = "";
  for await (const chunk of engine.stream(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      maxTokens: MAX_NEW_TOKENS,
      temperature: TEMPERATURE,
      topP: TOP_P,
      responseFormat: undefined,
    },
  )) {
    said += chunk;
  }
  return said;
}
