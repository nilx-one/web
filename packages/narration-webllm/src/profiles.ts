// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * How each family is asked to rephrase one sentence.
 *
 * One family could share one profile; four cannot. What differs between them here is measured
 * rather than assumed, and it is not sampling taste:
 *
 * - **How many tokens a Ukrainian sentence costs.** The same 166-character sentence is 58
 *   tokens for Llama 3.2's tokenizer and 143 for SmolLM2's. A bound that suits one cuts
 *   another's sentence in half, and a sentence cut off before its end can still carry only
 *   the numbers it was given — so it would pass a numeric check and read as a fact left
 *   unfinished. The first profile had one bound, 48 tokens, which at Qwen3's measured density
 *   already cut a rephrasing at about 85 characters.
 * - **The thinking switch.** `@aiaiaiai/webllm@0.1.0` sends `enable_thinking: false` with every
 *   completion, whatever the model. Only Qwen3 reads it. `@mlc-ai/web-llm@0.2.84` answers the
 *   flag for every family by writing a literal `<think>\n\n</think>\n\n` into the assistant's
 *   turn and into the output it decodes, so the other three families are handed text their
 *   templates never saw, and every family's reply begins with that block. The adapter strips
 *   it; the prompt-side half can only be closed in the foundation, where the switch is sent.
 *
 * Sampling is the same for all four until the on-device pass says otherwise: the table is where
 * a measured difference would go, not a place to guess one.
 */

import type { ModelFamily } from "./catalog";

/** A sentence longer than this is not a rephrasing of one line of evidence. */
export const MAX_SENTENCE_LENGTH = 180;

/**
 * Characters of Ukrainian per token, and what the empty thinking block costs, per tokenizer.
 *
 * Measured with the `tokenizer.json` each entry's pinned conversion ships (the commits in
 * `model-catalog.json`), on a 166-character Ukrainian rephrasing of a journal line. One
 * sentence is a sample, not a corpus; it is enough to show the spread is a factor of 2.5 and
 * not a rounding error.
 */
export interface UkrainianTokenDensity {
  readonly charsPerToken: number;
  readonly emptyThinkBlockTokens: number;
}

export const UKRAINIAN_TOKEN_DENSITY: Readonly<
  Record<ModelFamily, UkrainianTokenDensity>
> = {
  qwen3: { charsPerToken: 1.93, emptyThinkBlockTokens: 4 },
  smollm2: { charsPerToken: 1.16, emptyThinkBlockTokens: 9 },
  olmo2: { charsPerToken: 1.71, emptyThinkBlockTokens: 6 },
  "llama3.2": { charsPerToken: 2.86, emptyThinkBlockTokens: 6 },
};

/**
 * Tokens enough for the longest sentence the adapter would keep, plus the thinking block the
 * runtime writes into the output. Whether that block counts against the bound is the
 * runtime's business; the margin is spent either way.
 */
export function tokenBoundFor(density: UkrainianTokenDensity): number {
  return (
    Math.ceil(MAX_SENTENCE_LENGTH / density.charsPerToken) +
    density.emptyThinkBlockTokens
  );
}

export interface GenerationProfile {
  readonly maxNewTokens: number;
  readonly temperature: number;
  readonly topP: number;
  /** Whether this family's template reads the `enable_thinking` switch at all. */
  readonly readsThinkingSwitch: boolean;
}

/** One short rephrasing, kept close to its source. */
const SAMPLING = { temperature: 0.3, topP: 0.9 } as const;

export const GENERATION_PROFILES: Readonly<
  Record<ModelFamily, GenerationProfile>
> = {
  qwen3: {
    maxNewTokens: tokenBoundFor(UKRAINIAN_TOKEN_DENSITY.qwen3),
    ...SAMPLING,
    readsThinkingSwitch: true,
  },
  smollm2: {
    maxNewTokens: tokenBoundFor(UKRAINIAN_TOKEN_DENSITY.smollm2),
    ...SAMPLING,
    readsThinkingSwitch: false,
  },
  olmo2: {
    maxNewTokens: tokenBoundFor(UKRAINIAN_TOKEN_DENSITY.olmo2),
    ...SAMPLING,
    readsThinkingSwitch: false,
  },
  "llama3.2": {
    maxNewTokens: tokenBoundFor(UKRAINIAN_TOKEN_DENSITY["llama3.2"]),
    ...SAMPLING,
    readsThinkingSwitch: false,
  },
};
