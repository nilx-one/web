// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvatarModelId } from "@nilx-one/map-contract";

import { isRecordedGuideLine, type GuideVoice } from "../guide/guide-script";

import type { ProductLocale } from "../../shell/localization";
import { avaiaLines, type AvaiaLineKind } from "./avaia-lines";

/**
 * Where a line an Avaia says can be heard, when it can.
 *
 * Every fixed line in `avaia-lines.ts` was rendered ahead of time by
 * `tools/voices`, in the voice of the study that says it, and is served from
 * the product's own origin. The written line stays the fact: a line with no
 * recording is still on the card and still announced.
 */

/** The recorded set this build plays. A re-render is a new version. */
export const AVAIA_VOICE_VERSION = "0.1.0";

/** Locales a voice was found for whose license allows this product. */
export const VOICED_LOCALES: readonly ProductLocale[] = ["en", "uk-UA"];

/**
 * Kinds whose lines are fixed text. A line about a landmark carries its name,
 * which only the moment knows, so it is not recorded ahead of time.
 */
export const VOICED_KINDS: readonly AvaiaLineKind[] = [
  "walk",
  "blocked.building",
  "blocked.water",
  "blocked.fog",
  "fog.reveal",
  "fog.revealed",
  "fog.busy",
];

export interface AvaiaVoicedLine {
  readonly locale: ProductLocale;
  readonly model: AvatarModelId;
  readonly kind: AvaiaLineKind;
  /** The line exactly as it was written on the card. */
  readonly text: string;
}

export function avaiaVoicePath(
  locale: ProductLocale,
  model: AvatarModelId,
  kind: AvaiaLineKind,
  index: number,
): string {
  return `/voices/${AVAIA_VOICE_VERSION}/${locale}/${model}/${kind}.${index}.mp3`;
}

/** The recording of a line, or `undefined` when it has none. */
export function avaiaVoiceUrl(line: AvaiaVoicedLine): string | undefined {
  if (!VOICED_LOCALES.includes(line.locale)) return undefined;
  if (!VOICED_KINDS.includes(line.kind)) return undefined;
  const index = avaiaLines(line.locale, line.model, line.kind).indexOf(
    line.text,
  );
  if (index < 0) return undefined;
  return avaiaVoicePath(line.locale, line.model, line.kind, index);
}

/**
 * Where one of xSasha's lines can be heard, when it can. Her lines are
 * recorded once per voice she can speak in (the gender of the study she is
 * drawn in), and a line that carries a name is recorded without it.
 */
export function guideVoiceUrl(line: {
  readonly locale: ProductLocale;
  readonly voice: GuideVoice;
  readonly key: string;
}): string | undefined {
  if (!VOICED_LOCALES.includes(line.locale)) return undefined;
  if (!GUIDE_VOICES.includes(line.voice)) return undefined;
  if (!isRecordedGuideLine(line.key)) return undefined;
  return `/voices/${AVAIA_VOICE_VERSION}/${line.locale}/xsasha-${line.voice}/${line.key}.mp3`;
}

/**
 * The voices xSasha is recorded in: the genders of the studies `guideModel`
 * draws her in. Kai, who would speak in the neutral, is never her study.
 */
export const GUIDE_VOICES: readonly GuideVoice[] = ["feminine", "masculine"];
