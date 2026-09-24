// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  defaultLocalModel,
  findLocalModel,
  LOCAL_MODEL_CATALOG,
  LocalModelCatalogError,
  parseLocalModelCatalog,
} from "./catalog";
import raw from "./model-catalog.json";

function withModel(
  index: number,
  change: (model: Record<string, unknown>) => Record<string, unknown>,
): unknown {
  const copy = structuredClone(raw) as unknown as {
    models: Record<string, unknown>[];
  };
  const model = copy.models[index];
  if (model === undefined) throw new Error("no such model");
  copy.models[index] = change(model);
  return copy;
}

describe("the catalog this product serves", () => {
  it("serves five entries across four families, in presentation order", () => {
    expect(LOCAL_MODEL_CATALOG.models.map((model) => model.modelId)).toEqual([
      "Qwen3-0.6B-q4f16_1-MLC",
      "Qwen3-1.7B-q4f16_1-MLC",
      "SmolLM2-360M-Instruct-q4f16_1-MLC",
      "OLMo-2-0425-1B-Instruct-q4f16_1-MLC",
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    ]);
    expect(
      new Set(LOCAL_MODEL_CATALOG.models.map((model) => model.family)),
    ).toEqual(new Set(["qwen3", "smollm2", "olmo2", "llama3.2"]));
  });

  it("keeps Qwen3-0.6B as the default", () => {
    expect(defaultLocalModel(LOCAL_MODEL_CATALOG).modelId).toBe(
      "Qwen3-0.6B-q4f16_1-MLC",
    );
  });

  it("carries Llama's obligations on its entry and nobody else's", () => {
    const llama = findLocalModel(
      LOCAL_MODEL_CATALOG,
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    );
    expect(llama?.licence).toBe("llama3.2");
    expect(llama?.attribution).toBe("Built with Llama");
    expect(llama?.usePolicy).toBe("https://www.llama.com/llama3_2/use-policy");
    expect(llama?.notices[0]).toBe(
      "Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved.",
    );
    for (const model of LOCAL_MODEL_CATALOG.models) {
      if (model.licence !== "llama3.2") {
        expect(model.licence).toBe("apache-2.0");
        expect(model.attribution).toBeNull();
      }
    }
  });

  it("has measured no family's Ukrainian yet, and says so rather than assuming", () => {
    for (const model of LOCAL_MODEL_CATALOG.models) {
      expect(model.faithfulness).toBeNull();
    }
  });

  it("finds a served entry and nothing else", () => {
    expect(findLocalModel(LOCAL_MODEL_CATALOG, "gemma3-1b-it")).toBeUndefined();
    expect(findLocalModel(LOCAL_MODEL_CATALOG, undefined)).toBeUndefined();
  });
});

describe("a table this client refuses to offer from", () => {
  it("refuses an entry whose licence nobody read", () => {
    expect(() =>
      parseLocalModelCatalog(
        withModel(2, (model) => ({ ...model, notices: [] })),
      ),
    ).toThrow(LocalModelCatalogError);
  });

  it("refuses a family with no generation profile", () => {
    expect(() =>
      parseLocalModelCatalog(
        withModel(2, (model) => ({ ...model, family: "gemma3" })),
      ),
    ).toThrow(/no generation profile/);
  });

  it("refuses a Llama entry without the attribution its licence obliges", () => {
    expect(() =>
      parseLocalModelCatalog(
        withModel(4, (model) => ({ ...model, attribution: null })),
      ),
    ).toThrow(/obliges an attribution/);
  });

  it("refuses the same identifier served twice", () => {
    expect(() =>
      parseLocalModelCatalog(
        withModel(1, (model) => ({
          ...model,
          model_id: "Qwen3-0.6B-q4f16_1-MLC",
        })),
      ),
    ).toThrow(/served twice/);
  });

  it("refuses a faithfulness count that admits more than it tried", () => {
    expect(() =>
      parseLocalModelCatalog(
        withModel(0, (model) => ({
          ...model,
          faithfulness: { admitted: 7, total: 6, measured_on: "iPhone" },
        })),
      ),
    ).toThrow(/admitted sentences/);
  });
});
