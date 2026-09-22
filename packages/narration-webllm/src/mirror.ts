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

import type { AppConfig, ModelRecord } from "@mlc-ai/web-llm";

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
  | "origin_not_secure"
  | "unknown_schema"
  | "unsupported_identifier"
  | "integrity_not_sri"
  | "size_not_stated";

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
const SRI = /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

/**
 * Builds the config that loads this model from `origin`.
 *
 * @throws {MirrorConfigError} when the origin, the manifest schema, the identifiers or the
 * hashes are not ones this product is willing to load from. A mirror that cannot be
 * described exactly is not one to fall back from — the caller keeps whatever config it had.
 */
export function mirrorAppConfig(
  origin: string,
  manifest: MirrorManifest,
  cacheBackend: AppConfig["cacheBackend"] = "cache",
): AppConfig {
  if (!isSecureOrigin(origin)) {
    throw new MirrorConfigError(
      "origin_not_secure",
      `model origin must be HTTPS or localhost: ${origin}`,
    );
  }
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
  for (const hash of [
    manifest.integrity.config,
    manifest.integrity.model_lib,
    ...Object.values(manifest.integrity.tokenizer),
  ]) {
    if (!SRI.test(hash)) {
      throw new MirrorConfigError(
        "integrity_not_sri",
        `not an SRI hash: ${hash}`,
      );
    }
  }

  // The trailing `resolve/<revision>/` is what stops WebLLM appending `resolve/main/` of
  // its own, and it is also what makes the directory immutable.
  const base = `${origin.replace(/\/$/, "")}/models/${manifest.model_id}/resolve/${manifest.revision}/`;

  const record: ModelRecord = {
    model: base,
    model_id: manifest.model_id,
    model_lib: `${base}model.wasm`,
    // The prebuilt registry omits this on these entries, which lets a device without f16
    // download a whole model before failing to initialise it.
    required_features: ["shader-f16"],
    integrity: {
      config: manifest.integrity.config,
      model_lib: manifest.integrity.model_lib,
      tokenizer: { ...manifest.integrity.tokenizer },
      onFailure: "error",
    },
    overrides: { context_window_size: 4096 },
  };

  return { model_list: [record], cacheBackend };
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

function isSecureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" ||
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}
