// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Asking a model for one sentence, and deciding whether what came back may be shown.
 *
 * The deterministic sentence is the ground truth. The model is asked to say the same thing
 * differently, and anything it returns that could be a new fact — or that is not a finished
 * sentence at all — is discarded in favour of the sentence it was rephrasing.
 */

import type { ModelFamily } from "./catalog";
import { GENERATION_PROFILES, MAX_SENTENCE_LENGTH } from "./profiles";

/** Generation bounds for one rephrasing, taken from the family's profile. */
export interface RephraseOptions {
  readonly maxNewTokens: number;
  readonly temperature: number;
  readonly topP: number;
}

/** The engine surface narration needs, kept injectable so tests need no GPU. */
export interface LocalEngine {
  rephrase(
    system: string,
    user: string,
    options: RephraseOptions,
  ): Promise<string>;
  unload(): Promise<void>;
}

export const SYSTEM_PROMPT = [
  "Ти переказуєш один рядок особистого журналу присутності українською.",
  "Дозволено лише переформулювати надане речення: час, тривалість і те, що людина була тут.",
  "Заборонено додавати місця, причини, маршрут, погоду, настрій та інших людей.",
  "Заборонено вигадувати або змінювати числа.",
  "Відповідай одним коротким реченням і нічим більше.",
].join(" ");

/**
 * Drops the empty thinking block the pinned runtime writes at the start of every reply once
 * `enable_thinking: false` is sent — see `profiles.ts`. Only an empty block is removed: a
 * model that reasoned anyway has not written the sentence it was asked for.
 */
export function withoutEmptyThinkBlock(text: string): string {
  return text.replace(/^\s*<think>\s*<\/think>/u, "");
}

/**
 * Whether a rephrasing carries only what it was given, as a finished sentence.
 *
 * The concrete way a model invents is numeric: a time that was never recorded, a duration
 * rounded into a different one, a count of visits nobody made. So every digit sequence in the
 * sentence must already appear in the sentence it rephrased. Two further refusals are about
 * form: leaked markup is not a sentence, and a reply the token bound cut off does not end like
 * one. The check is narrow and cheap, and it fails closed — a sentence that does not pass is
 * replaced by the deterministic one rather than corrected.
 */
export function isFaithful(said: string, source: string): boolean {
  if (said === "" || said.length > MAX_SENTENCE_LENGTH) {
    return false;
  }
  if (/<\/?think>|<\|/u.test(said)) {
    return false;
  }
  if (!/[.!?…]["»”)\]]*$/u.test(said)) {
    return false;
  }
  const allowed = new Set(source.match(/\d+/gu) ?? []);
  return (said.match(/\d+/gu) ?? []).every((number) => allowed.has(number));
}

/**
 * Asks `engine` to rephrase one sentence under its family's profile.
 *
 * Returns the rephrasing when it may be shown, and `undefined` when the deterministic sentence
 * has to stand.
 */
export async function rephraseSentence(
  engine: LocalEngine,
  family: ModelFamily,
  sentence: string,
): Promise<string | undefined> {
  const profile = GENERATION_PROFILES[family];
  const raw = await engine.rephrase(SYSTEM_PROMPT, sentence, {
    maxNewTokens: profile.maxNewTokens,
    temperature: profile.temperature,
    topP: profile.topP,
  });
  const said = withoutEmptyThinkBlock(raw).trim();
  return isFaithful(said, sentence) ? said : undefined;
}
