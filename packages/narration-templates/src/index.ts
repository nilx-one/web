// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * Deterministic cell-bound narration.
 *
 * This adapter is the product, not a fallback: on every surface, with or without a model, a
 * lit cell can say what the journal holds about it. It states a start, a duration and
 * nothing else, because nothing else is in the evidence — no route, no reason, no company.
 *
 * A later model adapter serves the same contract and changes only how this reads.
 */

import {
  admitFragments,
  type CellEvidence,
  type NarrationAdapter,
  type NarrationCapability,
  type NarrationFragment,
} from "@nilx-one/narration-contract";

export interface TemplateNarrationOptions {
  /** BCP 47 tag used to format times and to choose plural forms. */
  readonly locale?: string;
  /** IANA zone. Supplied by the caller so the same evidence reads the same way in tests. */
  readonly timeZone?: string;
}

const ADAPTER_ID = "deterministic-templates";
const MINUTE_MS = 60_000;

/** Creates the deterministic adapter. It touches no network, no storage and no device. */
export function createTemplateNarrationAdapter(
  options: TemplateNarrationOptions = {},
): NarrationAdapter {
  const locale = options.locale ?? "uk-UA";
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
  });
  const plural = new Intl.PluralRules(locale);

  return {
    id: ADAPTER_ID,

    capability(): Promise<NarrationCapability> {
      // Deterministic narration has no device requirement to report honestly about.
      return Promise.resolve({ kind: "ready", adapter: ADAPTER_ID });
    },

    narrate(
      evidence: readonly CellEvidence[],
    ): Promise<readonly NarrationFragment[]> {
      const fragments = [...evidence]
        .sort((left, right) => left.from - right.from)
        .map((record) => ({
          cell: record.cell,
          at: record.from,
          text: sentence(record, time, plural),
        }));

      // Checked against the same boundary a model adapter is checked against. A check that
      // runs only over output you already trust is a check that has never run.
      return Promise.resolve(admitFragments(evidence, fragments).fragments);
    },
  };
}

function sentence(
  record: CellEvidence,
  time: Intl.DateTimeFormat,
  plural: Intl.PluralRules,
): string {
  const started = time.format(new Date(record.from));

  if (record.to === null) {
    // The visit has not ended. Choosing an end for it would be inventing evidence.
    return `${started} — ще тут.`;
  }

  const minutes = Math.floor((record.to - record.from) / MINUTE_MS);
  const ended = time.format(new Date(record.to));

  return minutes < 1
    ? `${started} — менше хвилини.`
    : `${started}–${ended} — ${minutes} ${minuteWord(minutes, plural)}.`;
}

function minuteWord(minutes: number, plural: Intl.PluralRules): string {
  switch (plural.select(minutes)) {
    case "one":
      return "хвилина";
    case "few":
      return "хвилини";
    default:
      return "хвилин";
  }
}
