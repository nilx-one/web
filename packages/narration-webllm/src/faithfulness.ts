// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The on-device pass that says whether a family is worth its download for narration.
 *
 * A family that almost never passes `isFaithful` falls back, sentence by sentence, to the
 * deterministic wording — silently, which is correct for a person reading and useless for a
 * person deciding what to download. Running this pass on a device and writing its result into
 * the entry's `faithfulness` in `model-catalog.json` is what lets Settings say so.
 *
 * The sentences are the shapes `@nilx-one/narration-templates` writes, stated here rather than
 * imported: this package may depend on nothing but the narration contract.
 */

import type { ModelFamily } from "./catalog";
import { rephraseSentence, type LocalEngine } from "./rephrase";

export const FAITHFULNESS_FIXTURE: readonly string[] = [
  "08:14–08:26 — 12 хвилин.",
  "08:14 — ще тут.",
  "19:02 — менше хвилини.",
  "21:40–22:55 — 75 хвилин.",
  "07:05–07:06 — 1 хвилина.",
  "13:30–13:33 — 3 хвилини.",
];

export interface FaithfulnessCount {
  readonly admitted: number;
  readonly total: number;
}

/** Runs every fixture sentence through `engine` and counts the rephrasings that may be shown. */
export async function measureFaithfulness(
  engine: LocalEngine,
  family: ModelFamily,
  sentences: readonly string[] = FAITHFULNESS_FIXTURE,
): Promise<FaithfulnessCount> {
  let admitted = 0;
  for (const sentence of sentences) {
    if ((await rephraseSentence(engine, family, sentence)) !== undefined) {
      admitted += 1;
    }
  }
  return { admitted, total: sentences.length };
}
