// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { MODEL_FAMILIES } from "./catalog";
import { FAITHFULNESS_FIXTURE, measureFaithfulness } from "./faithfulness";
import {
  GENERATION_PROFILES,
  MAX_SENTENCE_LENGTH,
  UKRAINIAN_TOKEN_DENSITY,
} from "./profiles";
import {
  isFaithful,
  withoutEmptyThinkBlock,
  type LocalEngine,
} from "./rephrase";

describe("a generation profile per family", () => {
  it("gives every family a bound long enough for the longest sentence it may keep", () => {
    for (const family of MODEL_FAMILIES) {
      const { charsPerToken, emptyThinkBlockTokens } =
        UKRAINIAN_TOKEN_DENSITY[family];
      expect(
        (GENERATION_PROFILES[family].maxNewTokens - emptyThinkBlockTokens) *
          charsPerToken,
      ).toBeGreaterThanOrEqual(MAX_SENTENCE_LENGTH);
    }
  });

  it("follows each tokenizer rather than one bound for all", () => {
    expect(GENERATION_PROFILES.qwen3.maxNewTokens).toBe(98);
    expect(GENERATION_PROFILES.smollm2.maxNewTokens).toBe(165);
    expect(GENERATION_PROFILES.olmo2.maxNewTokens).toBe(112);
    expect(GENERATION_PROFILES["llama3.2"].maxNewTokens).toBe(69);
  });

  it("no longer cuts Qwen3 at the 48 tokens that ended a sentence near 85 characters", () => {
    expect(GENERATION_PROFILES.qwen3.maxNewTokens).toBeGreaterThan(48);
  });

  it("knows only Qwen3 reads the thinking switch the foundation sends to every family", () => {
    expect(
      MODEL_FAMILIES.filter(
        (family) => GENERATION_PROFILES[family].readsThinkingSwitch,
      ),
    ).toEqual(["qwen3"]);
  });
});

describe("what may be shown", () => {
  it("drops only an empty thinking block", () => {
    expect(withoutEmptyThinkBlock("<think>\n\n</think>\n\nТак.")).toBe(
      "\n\nТак.",
    );
    expect(withoutEmptyThinkBlock("<think>ні</think>Так.")).toBe(
      "<think>ні</think>Так.",
    );
  });

  it("refuses a model that reasoned out loud, and leaked markup", () => {
    expect(isFaithful("<think>ні</think>Так.", "Так.")).toBe(false);
    expect(isFaithful("Так.<|eot_id|>", "Так.")).toBe(false);
  });

  it("refuses what does not end like a sentence", () => {
    expect(isFaithful("Був тут 12 хвилин", "12 хвилин.")).toBe(false);
    expect(isFaithful("Був тут 12 хвилин…", "12 хвилин.")).toBe(true);
    expect(isFaithful("«Був тут 12 хвилин.»", "12 хвилин.")).toBe(true);
  });
});

describe("the on-device faithfulness pass", () => {
  it("counts the rephrasings that may be shown out of every fixture sentence", async () => {
    let asked = 0;
    const engine: LocalEngine = {
      rephrase: (_system, user) => {
        asked += 1;
        // Faithful for every other sentence, inventing a number for the rest.
        return Promise.resolve(asked % 2 === 0 ? user : "Було 99 хвилин.");
      },
      unload: () => Promise.resolve(),
    };

    await expect(measureFaithfulness(engine, "olmo2")).resolves.toEqual({
      admitted: FAITHFULNESS_FIXTURE.length / 2,
      total: FAITHFULNESS_FIXTURE.length,
    });
  });
});
