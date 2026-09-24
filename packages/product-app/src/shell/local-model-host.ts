// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * What Settings needs from a local-inference host, stated without depending on any
 * concrete adapter.
 *
 * This product's WebGPU-touching code lives in `@nilx-one/narration-webllm`, on top of
 * `@aiaiaiai/webllm`, and this package is not allowed to import either — see
 * `tests/architecture/dependencies.test.ts`. Whoever composes this product's dependencies
 * (an `apps/*` root, which the architecture test does not constrain) builds the adapter
 * and satisfies this shape. `LocalModelSettings` never constructs one itself.
 */

import type { UnsupportedReason } from "./local-model-settings-view-model";

export type LocalModelDeviceVerdict =
  | { readonly kind: "usable" }
  | { readonly kind: Exclude<UnsupportedReason, "over_budget"> }
  | {
      readonly kind: "over_budget";
      /** What the entry states it needs, in MB. */
      readonly requiredMb: number;
      /** What this surface declared it will spend, in MB. */
      readonly budgetMb: number;
    };

/**
 * One entry a person may choose, carried as data: this package imports no model runtime.
 * Notices and attribution are here so they render before any download.
 */
export interface LocalModelCatalogEntry {
  readonly modelId: string;
  readonly family: string;
  readonly label: string;
  readonly vramMb: number;
  readonly licence: string;
  readonly licenceName: string;
  /** Text the licence obliges this product to display beside the entry, verbatim. */
  readonly attribution: string | null;
  /** A use policy the licence incorporates, linked where the entry is offered. */
  readonly usePolicy: string | null;
  readonly notices: readonly string[];
  /** How many fixture rephrasings an on-device pass kept, or `null` until one ran. */
  readonly faithfulness: {
    readonly admitted: number;
    readonly total: number;
  } | null;
}

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
  /** This device's verdict on one entry, including the budget its surface declared. */
  inspect(modelId: string): Promise<LocalModelDeviceVerdict>;
  isCached(modelId: string): Promise<boolean>;
  /** The size and provenance of the download `open` would start, without starting it. */
  describe(modelId: string): Promise<LocalModelDescription>;
  /**
   * Downloads when the artifacts are not cached, exactly as `open` on `WebLlmRuntimeHost`
   * does. Aborting `signal` abandons the download; the promise then rejects.
   */
  open(
    modelId: string,
    onProgress: (progress: LocalModelDownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<LocalModelEngine>;
  remove(modelId: string): Promise<void>;
}

/** What a deployment wiring this port names the model it serves. Read, never invented here. */
export interface LocalModelDependency {
  readonly host: LocalModelHost;
  /** Every entry this product serves, in presentation order. */
  readonly catalog: readonly LocalModelCatalogEntry[];
  /** What runs when nothing was chosen, and what a refused choice falls back to. */
  readonly defaultModelId: string;
}
