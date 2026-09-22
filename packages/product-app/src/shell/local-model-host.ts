// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What Settings needs from a local-inference host, stated without depending on any
 * concrete adapter.
 *
 * This product's WebGPU-touching code lives in `@nilx-one/narration-webllm`, which this
 * package is not allowed to import — see `tests/architecture/dependencies.test.ts`. That is
 * not a gap to route around: `nilx-one/ai#17` is why no published foundation package exists
 * for either side to depend on instead, so whoever composes this product's dependencies (an
 * `apps/*` root, which the architecture test does not constrain) builds the adapter and
 * satisfies this shape. `LocalModelSettings` never constructs one itself.
 */

import type { UnsupportedReason } from "./local-model-settings-view-model";

export type LocalModelDeviceVerdict =
  { readonly kind: "usable" } | { readonly kind: UnsupportedReason };

export interface LocalModelDownloadProgress {
  readonly ratio: number;
  readonly text: string;
}

export type LocalModelDescription =
  | {
      readonly bytes: number;
      readonly source: "mirror" | "upstream";
      readonly notices: readonly string[];
    }
  | { readonly bytes: null; readonly source: "mirror" | "upstream" };

export interface LocalModelEngine {
  unload(): Promise<void>;
}

export interface LocalModelHost {
  inspect(): Promise<LocalModelDeviceVerdict>;
  isCached(modelId: string): Promise<boolean>;
  /** The size and provenance of the download `open` would start, without starting it. */
  describe(modelId: string): Promise<LocalModelDescription>;
  /** Downloads when the artifacts are not cached, exactly as `open` on `WebLlmRuntimeHost` does. */
  open(
    modelId: string,
    onProgress: (progress: LocalModelDownloadProgress) => void,
  ): Promise<LocalModelEngine>;
  remove(modelId: string): Promise<void>;
}

/** What a deployment wiring this port names the model it serves. Read, never invented here. */
export interface LocalModelDependency {
  readonly host: LocalModelHost;
  readonly modelId: string;
}
