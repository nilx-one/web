// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The local models this product serves, read from the one table every side reads.
 *
 * `model-catalog.json` is what `deploy/web/bootstrap-models.sh` mirrors from, what
 * `check-models-public.sh` asks the public origin about, and what Settings offers — so the
 * models a person can choose and the models that exist cannot drift apart. The licence
 * reading behind each entry's notices is recorded in `nilx-one/ai`'s
 * `docs/model-licences.md`; an entry without notices is refused here, because nothing is
 * served before its licence is read.
 *
 * Which entries are served and which is the default is `nilx-one/ai`'s decision
 * (`src/inference.rs` there). This file restates it for the browser and is checked against
 * the same eligibility fixture.
 */

import raw from "./model-catalog.json";

/** A family shares a tokenizer, a conversation template and a way of being prompted. */
export type ModelFamily = "qwen3" | "smollm2" | "olmo2" | "llama3.2";

export const MODEL_FAMILIES: readonly ModelFamily[] = [
  "qwen3",
  "smollm2",
  "olmo2",
  "llama3.2",
];

/** How many fixture sentences a family's rephrasings survived, measured on a device. */
export interface MeasuredFaithfulness {
  readonly admitted: number;
  readonly total: number;
  /** Which device and surface the pass ran on, in the words of whoever ran it. */
  readonly measuredOn: string;
}

export interface LocalModelEntry {
  readonly modelId: string;
  readonly family: ModelFamily;
  readonly label: string;
  /** The pinned registry's `vram_required_MB`: a claim measured elsewhere, not a reading. */
  readonly vramMb: number;
  readonly contextWindow: number;
  /** The licence identifier the upstream model card's `license:` field carries. */
  readonly licence: string;
  readonly licenceName: string;
  /** Text the licence obliges this product to display beside the entry, verbatim. */
  readonly attribution: string | null;
  /** A use policy the licence incorporates by reference, linked where the entry is offered. */
  readonly usePolicy: string | null;
  /** Redistribution notices, shown before any download and written into the mirror. */
  readonly notices: readonly string[];
  /** `null` until an on-device pass has been recorded for this entry. */
  readonly faithfulness: MeasuredFaithfulness | null;
  /** The immutable mirror revision `bootstrap-models.sh` writes this entry under. */
  readonly mirrorRevision: string;
}

export interface LocalModelCatalog {
  /** What runs where nobody can be asked, and what a refused choice falls back to. */
  readonly defaultModelId: string;
  /** In presentation order. The order is not a preference anything reads. */
  readonly models: readonly LocalModelEntry[];
}

export class LocalModelCatalogError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LocalModelCatalogError";
  }
}

const SAFE_SEGMENT = /^[0-9A-Za-z._-]+$/;
/** Licences whose terms oblige a visible attribution and incorporate a use policy. */
const ATTRIBUTING_LICENCES: ReadonlySet<string> = new Set(["llama3.2"]);

function fail(message: string): never {
  throw new LocalModelCatalogError(message);
}

function objectAt(
  value: unknown,
  where: string,
): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${where} is not an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function textAt(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${where} is not a non-empty string`);
  }
  return value;
}

function optionalTextAt(value: unknown, where: string): string | null {
  return value === null ? null : textAt(value, where);
}

function positiveAt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail(`${where} is not a positive number`);
  }
  return value;
}

function familyAt(value: unknown, where: string): ModelFamily {
  const family = textAt(value, where);
  const known = MODEL_FAMILIES.find((candidate) => candidate === family);
  if (known === undefined) {
    fail(`${where} names ${family}, which has no generation profile`);
  }
  return known;
}

function faithfulnessAt(
  value: unknown,
  where: string,
): MeasuredFaithfulness | null {
  if (value === null) {
    return null;
  }
  const measured = objectAt(value, where);
  const admitted = measured.admitted;
  const total = measured.total;
  if (
    typeof admitted !== "number" ||
    typeof total !== "number" ||
    !Number.isInteger(admitted) ||
    !Number.isInteger(total) ||
    admitted < 0 ||
    total <= 0 ||
    admitted > total
  ) {
    fail(`${where} is not a count of admitted sentences out of a total`);
  }
  return {
    admitted,
    total,
    measuredOn: textAt(measured.measured_on, `${where}.measured_on`),
  };
}

function entryAt(value: unknown, where: string): LocalModelEntry {
  const item = objectAt(value, where);
  const modelId = textAt(item.model_id, `${where}.model_id`);
  if (!SAFE_SEGMENT.test(modelId)) {
    fail(`${where}.model_id is not a single safe path segment`);
  }
  const mirror = objectAt(item.mirror, `${where}.mirror`);
  const mirrorRevision = textAt(mirror.revision, `${where}.mirror.revision`);
  if (!SAFE_SEGMENT.test(mirrorRevision)) {
    fail(`${where}.mirror.revision is not a single safe path segment`);
  }
  if (!Array.isArray(item.notices) || item.notices.length === 0) {
    fail(
      `${where}.notices is empty: nothing is served before its licence is read`,
    );
  }
  const notices = item.notices.map((notice: unknown, index) =>
    textAt(notice, `${where}.notices[${String(index)}]`),
  );
  const licence = textAt(item.licence, `${where}.licence`);
  const attribution = optionalTextAt(item.attribution, `${where}.attribution`);
  const usePolicy = optionalTextAt(item.use_policy, `${where}.use_policy`);
  if (
    ATTRIBUTING_LICENCES.has(licence) &&
    (attribution === null || usePolicy === null)
  ) {
    fail(
      `${where} is served under ${licence}, which obliges an attribution and a use policy`,
    );
  }

  return {
    modelId,
    family: familyAt(item.family, `${where}.family`),
    label: textAt(item.label, `${where}.label`),
    vramMb: positiveAt(item.vram_mb, `${where}.vram_mb`),
    contextWindow: positiveAt(item.context_window, `${where}.context_window`),
    licence,
    licenceName: textAt(item.licence_name, `${where}.licence_name`),
    attribution,
    usePolicy,
    notices,
    faithfulness: faithfulnessAt(item.faithfulness, `${where}.faithfulness`),
    mirrorRevision,
  };
}

/**
 * Reads a catalog table, refusing one this client should not offer from.
 *
 * @throws {LocalModelCatalogError} naming the first thing wrong with it.
 */
export function parseLocalModelCatalog(value: unknown): LocalModelCatalog {
  const root = objectAt(value, "catalog");
  if (root.schema !== 1) {
    fail("the catalog schema is not one this client knows how to read");
  }
  const defaultModelId = textAt(root.default_model_id, "default_model_id");
  if (!Array.isArray(root.models) || root.models.length === 0) {
    fail("the catalog serves no models");
  }
  const models = root.models.map((item: unknown, index) =>
    entryAt(item, `models[${String(index)}]`),
  );
  const ids = new Set(models.map((model) => model.modelId));
  if (ids.size !== models.length) {
    fail("a model_id is served twice");
  }
  if (!ids.has(defaultModelId)) {
    fail("the default is not one of the served models");
  }
  return { defaultModelId, models };
}

/** This product's catalog, read once when the module loads. */
export const LOCAL_MODEL_CATALOG: LocalModelCatalog =
  parseLocalModelCatalog(raw);

/** Returns the served entry with this `model_id`, or `undefined` for anything else. */
export function findLocalModel(
  catalog: LocalModelCatalog,
  modelId: string | undefined,
): LocalModelEntry | undefined {
  return modelId === undefined
    ? undefined
    : catalog.models.find((model) => model.modelId === modelId);
}

/** Returns the catalog's default entry, which the parse guarantees is served. */
export function defaultLocalModel(catalog: LocalModelCatalog): LocalModelEntry {
  const entry = findLocalModel(catalog, catalog.defaultModelId);
  if (entry === undefined) {
    fail("the default is not one of the served models");
  }
  return entry;
}
