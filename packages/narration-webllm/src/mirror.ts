// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Loading the model from our own origin.
 *
 * Stage one serves model artifacts from the host that already serves the app, next to the
 * basemap and under the same Caddy. That answers three questions at once: no third party
 * learns who is loading an avatar, the bytes are same-origin so nothing has to be
 * negotiated with CORS, and the revision directory `deploy/web/bootstrap-models.sh` writes
 * is immutable, so a re-acquisition after cache eviction is a cache hit rather than a
 * download.
 *
 * The manifest that script writes is the other half: it carries the honest download size,
 * so a person can be told what they are about to fetch without fetching anything, and the
 * SRI hashes WebLLM verifies for the config, the tokenizer and the model library.
 */

import {
  validateServedCatalog,
  type CacheBackend,
  type ServedCatalog,
} from "@aiaiaiai/webllm";

/** What `bootstrap-models.sh` writes beside the artifacts it placed. */
export interface MirrorManifest {
  readonly schema: number;
  readonly model_id: string;
  readonly revision: string;
  readonly bytes: number;
  readonly integrity: {
    readonly config: string;
    readonly tokenizer: Readonly<Record<string, string>>;
    readonly model_lib: string;
  };
  /** Redistribution attribution `bootstrap-models.sh` records. Absent from older manifests. */
  readonly notices?: readonly string[];
}

export type MirrorRefusal =
  "unknown_schema" | "unsupported_identifier" | "size_not_stated";

export class MirrorConfigError extends Error {
  public constructor(
    public readonly refusal: MirrorRefusal,
    message: string,
  ) {
    super(message);
    this.name = "MirrorConfigError";
  }
}

const SUPPORTED_SCHEMA = 1;
const SAFE_SEGMENT = /^[0-9A-Za-z._-]+$/;

/**
 * Builds the catalog that serves this model from `origin`.
 *
 * What is checked here is this product's manifest format — its schema, its identifiers, the
 * size it must state. What a mirror has to get right to be loaded from at all — HTTPS, an
 * immutable `resolve/<revision>/` segment, well-formed SRI digests — is `@aiaiaiai/webllm`'s
 * opinion, and `validateServedCatalog` applies it before this returns, so a catalog that
 * comes back is one the loader will accept.
 *
 * @throws {MirrorConfigError} when the manifest is not one this product knows how to read.
 * @throws {LocalInferenceError} (`invalid_catalog`) when the mirror it describes is not one
 * the foundation will load from. Either way the caller keeps whatever source it had.
 */
export function mirrorCatalog(
  origin: string,
  manifest: MirrorManifest,
  cacheBackend?: CacheBackend,
): ServedCatalog {
  if (manifest.schema !== SUPPORTED_SCHEMA) {
    throw new MirrorConfigError(
      "unknown_schema",
      `manifest schema ${manifest.schema} is not one this client knows how to read`,
    );
  }
  if (
    !SAFE_SEGMENT.test(manifest.model_id) ||
    !SAFE_SEGMENT.test(manifest.revision)
  ) {
    throw new MirrorConfigError(
      "unsupported_identifier",
      "model id and revision must be single safe path segments",
    );
  }
  if (!Number.isInteger(manifest.bytes) || manifest.bytes <= 0) {
    throw new MirrorConfigError(
      "size_not_stated",
      "a mirror manifest must state the download size it is offering",
    );
  }

  // The trailing `resolve/<revision>/` is what stops WebLLM appending `resolve/main/` of
  // its own, and it is also what makes the directory immutable.
  const base = `${origin.replace(/\/$/, "")}/models/${manifest.model_id}/resolve/${manifest.revision}/`;

  const catalog: ServedCatalog = {
    models: [
      {
        modelId: manifest.model_id,
        artifacts: base,
        modelLib: `${base}model.wasm`,
        // Also derived from the identifier by the foundation; stated so the manifest this
        // product writes is not the only place it is implied.
        requiredFeatures: ["shader-f16"],
        contextWindowSize: 4096,
        integrity: {
          config: manifest.integrity.config,
          modelLib: manifest.integrity.model_lib,
          tokenizer: { ...manifest.integrity.tokenizer },
        },
      },
    ],
    ...(cacheBackend === undefined ? {} : { cacheBackend }),
  };
  validateServedCatalog(catalog);
  return catalog;
}

/**
 * The download size, answered without a request.
 *
 * The upstream path has to fetch an artifact manifest to learn this; a mirror states it in
 * a file the client already trusts, so a person can be told the cost before anything at all
 * is fetched.
 */
export function describeMirrorDownload(manifest: MirrorManifest): {
  readonly bytes: number;
} {
  return { bytes: manifest.bytes };
}

/** Reads the manifest for one revision. Returns `null` when there is nothing to read. */
export async function loadMirrorManifest(
  origin: string,
  modelId: string,
  revision: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MirrorManifest | null> {
  if (
    !isSecureOrigin(origin) ||
    !SAFE_SEGMENT.test(modelId) ||
    !SAFE_SEGMENT.test(revision)
  ) {
    return null;
  }

  const url = `${origin.replace(/\/$/, "")}/models/${modelId}/resolve/${revision}/manifest.json`;
  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return null;
    }
    const manifest = (await response.json()) as MirrorManifest;
    return manifest.model_id === modelId && manifest.revision === revision
      ? manifest
      : null;
  } catch {
    return null;
  }
}

/**
 * Only an HTTPS origin is worth asking: `@aiaiaiai/webllm` loads no artifact over plaintext,
 * local development included, so a manifest read from one could only be refused afterwards.
 */
function isSecureOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === "https:";
  } catch {
    return false;
  }
}
