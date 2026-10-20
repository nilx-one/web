// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { MapLandmark } from "@nilx-one/map-contract";

import type { ProductLocale } from "../../shell/localization";

/**
 * How the Avaia describes a landmark she stands in front of, and which of a
 * local model's retellings may be shown instead: the port of `src/describe.rs`
 * in `nilx-one/ai`, held to the same cases by `landmark-description.json`,
 * which that repository owns and this one copies byte for byte.
 *
 * The template is the description. A model only retells it, and a retelling
 * that could carry a new fact is refused, never corrected.
 */

/** The archive facts a description may use, in the order it uses them. */
export const DESCRIBED_FACTS = [
  "start_date",
  "artist_name",
  "architect",
  "height",
  "material",
] as const;

type DescribedFact = (typeof DESCRIBED_FACTS)[number];

/** What she is told before she retells a description. */
export const DESCRIBE_SYSTEM_PROMPT =
  "You are Avaia, looking at a landmark on a walk. Retell the description you are given in your own words, in the same language, in at most two short sentences. Use only what it says: never add a date, a number, a name, a person, an event or a place it does not contain. Answer with the description and nothing else.";

/** The longest description that may be shown or kept, in characters. */
export const DESCRIPTION_MAX_CHARS = 240;

/** The template the kept descriptions are worded from: the fixture's schema. */
export const DESCRIPTION_TEMPLATE_VERSION = 1;

const VALUE_MAX_CHARS = 80;
const MAX_SENTENCES = 3;
const KIND = /^[a-z][a-z_]{0,31}$/;
const MARKUP = /[<>{}`|]/u;

/** The capitalised words a retelling may open a sentence with that are no name. */
const OPENERS = new Set([
  "It",
  "Its",
  "This",
  "The",
  "A",
  "An",
  "Here",
  "She",
  "Це",
  "Цей",
  "Ця",
  "Вона",
  "Тут",
  "Это",
  "Этот",
  "Эта",
  "Она",
  "Здесь",
]);

/** How many leading letters two words must share to be the same word declined. */
const STEM_CHARS = 4;
const CONTROL = /\p{Cc}/u;

export type DescribeLocale = "uk" | "en" | "ru";

/** What the host sends the faculty: `{locale, kind, kind_label, name?, facts}`. */
export interface DescribeInput {
  readonly locale: DescribeLocale;
  readonly kind: string;
  readonly kind_label: string;
  readonly name?: string;
  readonly facts?: Readonly<Record<string, unknown>>;
}

/** What the archive declares about one landmark, as a description may use it. */
export interface LandmarkFacts {
  readonly locale: DescribeLocale;
  readonly kindLabel: string;
  readonly name: string | undefined;
  readonly facts: readonly (readonly [DescribedFact, string])[];
}

/** Reads the input, or `undefined` when its kind or kind label is unreadable. */
export function readLandmarkFacts(input: unknown): LandmarkFacts | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const known = new Set(["locale", "kind", "kind_label", "name", "facts"]);
  if (Object.keys(record).some((key) => !known.has(key))) return undefined;
  const { locale, kind, kind_label: kindLabel, name, facts } = record;
  if (locale !== "uk" && locale !== "en" && locale !== "ru") return undefined;
  if (typeof kind !== "string" || !KIND.test(kind)) return undefined;
  const label = typeof kindLabel === "string" ? plain(kindLabel) : undefined;
  if (label === undefined) return undefined;
  if (name !== undefined && name !== null && typeof name !== "string") {
    return undefined;
  }
  if (
    facts !== undefined &&
    (typeof facts !== "object" || facts === null || Array.isArray(facts))
  ) {
    return undefined;
  }
  const given = (facts ?? {}) as Record<string, unknown>;
  const kept: (readonly [DescribedFact, string])[] = [];
  for (const key of DESCRIBED_FACTS) {
    const raw = given[key];
    const value =
      typeof raw === "string"
        ? plain(raw)
        : typeof raw === "number" && Number.isFinite(raw)
          ? String(raw)
          : undefined;
    if (value === undefined) continue;
    const said = factValue(key, value);
    if (said !== undefined) kept.push([key, said]);
  }
  return {
    locale,
    kindLabel: label,
    name: typeof name === "string" ? plain(name) : undefined,
    facts: kept,
  };
}

/** Tier 0: the description itself, worded from the facts and nothing else. */
export function descriptionTemplate(facts: LandmarkFacts): string {
  let text =
    facts.name === undefined
      ? `${capitalized(facts.kindLabel)}.`
      : `${facts.name} — ${facts.kindLabel}.`;
  for (const [key, value] of facts.facts) {
    text += ` ${factSentence(facts.locale, key, value)}`;
  }
  return text;
}

/**
 * The retelling when it may stand in for the template, else `undefined`:
 * too long, markup, unfinished or past three sentences, a number or a
 * capitalised word the template does not carry, or the landmark's name left
 * out. A declined name passes: a capitalised word only has to share its first
 * four letters with a template word.
 */
export function admitDescription(
  facts: LandmarkFacts,
  said: string,
): string | undefined {
  const text = withoutEmptyThinkBlock(said).trim();
  const chars = [...text].length;
  if (chars === 0 || chars > DESCRIPTION_MAX_CHARS) return undefined;
  if (MARKUP.test(text) || CONTROL.test(text)) return undefined;
  const ends = /[.!?…]$/u.test(text.replace(/["»”)]+$/u, ""));
  if (!ends || sentenceEnds(text) > MAX_SENTENCES) return undefined;
  const known = new Set(numbers(descriptionTemplate(facts)));
  if (numbers(text).some((number) => !known.has(number))) return undefined;
  if (facts.name !== undefined && !text.includes(facts.name)) return undefined;
  const stems = new Set(words(descriptionTemplate(facts)).map(stem));
  const newName = words(text).some(
    (word) =>
      /^\p{Uppercase}/u.test(word) &&
      !OPENERS.has(word) &&
      !stems.has(stem(word)),
  );
  return newName ? undefined : text;
}

/**
 * The faculty's input for a landmark the map draws: its archive facts, in the
 * language this person reads, and nothing about the person.
 */
export function describeInput(
  landmark: MapLandmark,
  locale: ProductLocale,
  kindLabel: string,
): DescribeInput {
  const language: DescribeLocale =
    locale === "uk-UA" ? "uk" : locale === "ru-RU" ? "ru" : "en";
  const localized = landmark.facts[`name:${language}`];
  const name =
    typeof localized === "string" && localized.length > 0
      ? localized
      : landmark.name;
  return {
    locale: language,
    kind: landmark.kind,
    kind_label: kindLabel,
    ...(name === undefined || name.length === 0 ? {} : { name }),
    facts: landmark.facts,
  };
}

function factSentence(
  locale: DescribeLocale,
  key: DescribedFact,
  value: string,
): string {
  switch (locale) {
    case "uk":
      return {
        start_date: `З ${value} року.`,
        artist_name: `Автор — ${value}.`,
        architect: `Архітектор — ${value}.`,
        height: `Висота — ${value} м.`,
        material: `Матеріал — ${value}.`,
      }[key];
    case "ru":
      return {
        start_date: `С ${value} года.`,
        artist_name: `Автор — ${value}.`,
        architect: `Архитектор — ${value}.`,
        height: `Высота — ${value} м.`,
        material: `Материал — ${value}.`,
      }[key];
    case "en":
      return {
        start_date: `Since ${value}.`,
        artist_name: `By ${value}.`,
        architect: `Architect: ${value}.`,
        height: `${value} m tall.`,
        material: `Made of ${value}.`,
      }[key];
  }
}

function factValue(key: DescribedFact, value: string): string | undefined {
  if (key === "start_date") {
    return numbers(value).find((run) => run.length === 4);
  }
  if (key === "height") return metres(value);
  return value;
}

/** A positive height in metres, with at most one decimal, without a unit. */
function metres(value: string): string | undefined {
  const trimmed = value.trim();
  const number = (
    trimmed.endsWith("m") ? trimmed.slice(0, -1) : trimmed
  ).trim();
  const dot = number.indexOf(".");
  const whole = dot === -1 ? number : number.slice(0, dot);
  const fraction = dot === -1 ? "" : number.slice(dot + 1);
  const digits = (part: string) => /^[0-9]*$/.test(part);
  if (
    whole.length === 0 ||
    whole.length > 4 ||
    !digits(whole) ||
    !digits(fraction)
  ) {
    return undefined;
  }
  const stripped = whole.replace(/^0+/, "") || "0";
  const tenth = fraction[0];
  const said =
    tenth !== undefined && tenth !== "0" ? `${stripped}.${tenth}` : stripped;
  return said === "0" ? undefined : said;
}

/** A short single line of plain text, trimmed, or `undefined`. */
function plain(value: string): string | undefined {
  const text = value.trim();
  const readable =
    text.length > 0 &&
    [...text].length <= VALUE_MAX_CHARS &&
    !CONTROL.test(text) &&
    !MARKUP.test(text);
  return readable ? text : undefined;
}

/** Sentence ends: a terminator at the end or before a space, not a decimal point. */
function sentenceEnds(text: string): number {
  const chars = [...text];
  return chars.filter(
    (c, at) =>
      /[.!?…]/u.test(c) &&
      (at + 1 === chars.length || /\s/u.test(chars[at + 1]!)),
  ).length;
}

function words(text: string): string[] {
  return text.split(/[^\p{Alphabetic}]+/u).filter((word) => word.length > 0);
}

function stem(word: string): string {
  return [...word].slice(0, STEM_CHARS).join("").toLowerCase();
}

function numbers(text: string): string[] {
  return text.match(/[0-9]+/g) ?? [];
}

function capitalized(text: string): string {
  const [first, ...rest] = [...text];
  return first === undefined ? "" : first.toUpperCase() + rest.join("");
}

function withoutEmptyThinkBlock(text: string): string {
  const match = /^\s*<think>\s*<\/think>/u.exec(text);
  return match === null ? text : text.slice(match[0].length);
}
