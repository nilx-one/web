// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { AvatarModelId } from "@nilx-one/map-contract";

import type { Translate, TranslationKey } from "../../shell/localization";
import type { GuideShot } from "./guide-stage";

/**
 * xSasha's scenes, as a small dialogue graph.
 *
 * A scene is presentation and nothing else: what she says creates no
 * Interaction, completes no BondChain and asserts nothing about any Bond. The
 * one thing a scene may pay is an achievement the product already priced —
 * she only says it out loud.
 */
export type GuideSceneId = "intro" | "reward" | "backpack" | "territory";

export type GuideNodeId =
  | "greeting"
  | "howTo"
  | "farewell"
  | "almostForgot"
  | "together"
  | "backpackGift"
  | "newGround";

/**
 * How a scene ended, which is all the world is told about it.
 *
 * - `later` — she comes back the next time the world opens;
 * - `skipped` — a person asked not to see this scene again on this device;
 * - `create` — a person went to create their Avaia, so its screen opens;
 * - `done` — the scene said what it had to;
 * - `together` — the Bond and its new Avaia take it from here.
 */
export type GuideOutcome = "later" | "skipped" | "create" | "done" | "together";

export type GuideReply =
  "curious" | "later" | "go" | "thanks" | "skip" | "continue";

/**
 * The grammatical gender a line is said in. A study speaks in its own: Sky in
 * the masculine, both Dashas in the feminine, and Kai in forms that carry no
 * gender at all — the same rule an Avaia's own voice follows. She speaks in
 * the voice of the study she is drawn in, the Bond's replies in its own.
 */
export type GuideVoice = "feminine" | "masculine" | "neutral";

export function studyVoice(model: AvatarModelId | undefined): GuideVoice {
  switch (model) {
    case "sky-study":
      return "masculine";
    case "dasha-study":
    case "dasha-v2-study":
      return "feminine";
    case "kai-study":
    case undefined:
      return "neutral";
  }
}

/**
 * One wording of a line: the same in every voice, or written once per voice
 * where the language marks who is speaking.
 */
export type GuideWording =
  TranslationKey | Readonly<Record<GuideVoice, TranslationKey>>;

function voiced(wording: GuideWording, voice: GuideVoice): TranslationKey {
  return typeof wording === "string" ? wording : wording[voice];
}

/** One of her lines whose catalogue carries a wording for each voice. */
type VoicedKey = TranslationKey extends infer Key
  ? Key extends `${infer Stem extends `guide.${string}`}.feminine`
    ? Stem
    : never
  : never;

function inVoices(
  key: VoicedKey,
): Readonly<Record<GuideVoice, TranslationKey>> {
  return {
    feminine: `${key}.feminine`,
    masculine: `${key}.masculine`,
    neutral: `${key}.neutral`,
  };
}

export interface GuideChoice {
  readonly reply: GuideReply;
  readonly next: GuideNodeId | { readonly end: GuideOutcome };
}

export interface GuideNode {
  /** One line in every wording it has. */
  readonly line: readonly GuideWording[];
  readonly shot: GuideShot;
  /** The line is said with the achievement the scene is paying beside it. */
  readonly reward?: true;
  /**
   * Not recorded yet: the line is typed out and not said aloud until a
   * render adds it (`docs/avaia-voice.md`).
   */
  readonly recorded?: false;
  readonly choices: readonly GuideChoice[];
}

export const GUIDE_OPENING: Readonly<Record<GuideSceneId, GuideNodeId>> = {
  intro: "greeting",
  reward: "almostForgot",
  backpack: "backpackGift",
  territory: "newGround",
};

export const GUIDE_NODES: Readonly<Record<GuideNodeId, GuideNode>> = {
  greeting: {
    line: [
      inVoices("guide.intro.greeting.0"),
      inVoices("guide.intro.greeting.1"),
      inVoices("guide.intro.greeting.2"),
    ],
    shot: "dasha",
    choices: [
      { reply: "curious", next: "howTo" },
      { reply: "later", next: "farewell" },
    ],
  },
  howTo: {
    line: ["guide.intro.howTo.0", "guide.intro.howTo.1"],
    shot: "two-shot",
    choices: [
      { reply: "go", next: { end: "create" } },
      { reply: "later", next: "farewell" },
    ],
  },
  farewell: {
    line: ["guide.intro.farewell.0", "guide.intro.farewell.1"],
    shot: "dasha",
    choices: [{ reply: "continue", next: { end: "later" } }],
  },
  almostForgot: {
    line: [
      inVoices("guide.reward.almostForgot.0"),
      inVoices("guide.reward.almostForgot.1"),
      "guide.reward.almostForgot.2",
    ],
    shot: "reward",
    reward: true,
    choices: [
      { reply: "thanks", next: "together" },
      { reply: "skip", next: { end: "done" } },
    ],
  },
  together: {
    line: ["guide.reward.together.0", "guide.reward.together.1"],
    shot: "together",
    choices: [{ reply: "continue", next: { end: "together" } }],
  },
  backpackGift: {
    line: [
      "guide.backpack.gift.0",
      "guide.backpack.gift.1",
      "guide.backpack.gift.2",
    ],
    shot: "reward",
    reward: true,
    recorded: false,
    choices: [
      { reply: "thanks", next: { end: "done" } },
      { reply: "skip", next: { end: "done" } },
    ],
  },
  newGround: {
    line: [
      "guide.territory.newGround.0",
      "guide.territory.newGround.1",
      "guide.territory.newGround.2",
    ],
    shot: "two-shot",
    recorded: false,
    choices: [
      { reply: "thanks", next: { end: "done" } },
      { reply: "skip", next: { end: "done" } },
    ],
  },
};

/** Every wording of every line not recorded yet. */
const UNRECORDED_KEYS: ReadonlySet<string> = new Set(
  Object.values(GUIDE_NODES)
    .filter((node) => node.recorded === false)
    .flatMap((node) =>
      node.line.flatMap((wording) =>
        typeof wording === "string" ? [wording] : Object.values(wording),
      ),
    ),
);

/** Whether a line of hers has a recording to play. */
export function isRecordedGuideLine(key: string): boolean {
  return !UNRECORDED_KEYS.has(key);
}

const REPLY_KEYS: Readonly<Record<GuideReply, readonly GuideWording[]>> = {
  curious: [
    inVoices("guide.choice.curious.0"),
    inVoices("guide.choice.curious.1"),
    "guide.choice.curious.2",
  ],
  later: [
    "guide.choice.later.0",
    "guide.choice.later.1",
    "guide.choice.later.2",
  ],
  go: ["guide.choice.go.0", "guide.choice.go.1"],
  thanks: [
    "guide.choice.thanks.0",
    "guide.choice.thanks.1",
    "guide.choice.thanks.2",
  ],
  skip: ["guide.choice.skip"],
  continue: ["guide.choice.continue"],
};

/**
 * A stage direction rather than something a person says: choosing it is not
 * followed by a line of their own.
 */
export function isSpokenReply(reply: GuideReply): boolean {
  return reply !== "skip" && reply !== "continue";
}

function saltOf(value: string): number {
  let hash = 0x811c9dc5;
  for (const scalar of value) {
    hash ^= scalar.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * One wording out of several. Consecutive seeds always land on a different
 * wording of the same line, so a scene played again never repeats itself word
 * for word.
 */
export function pickVariant<T>(
  variants: readonly T[],
  seed: number,
  salt: string,
): T {
  const index = (saltOf(salt) + (seed >>> 0)) % variants.length;
  const picked = variants[index] ?? variants[0];
  if (picked === undefined) throw new Error("A line needs a wording.");
  return picked;
}

export interface GuideNames {
  readonly avaia: string;
  /** The Bond's `pub_dress`, which is what she calls it when she pays it. */
  readonly bond: string;
}

export interface GuideChoiceViewState {
  readonly reply: GuideReply;
  readonly text: string;
}

export interface GuideLineViewState {
  readonly node: GuideNodeId;
  readonly speaker: string;
  readonly text: string;
  /** The catalogue key the line was said from: which wording, in which voice. */
  readonly key: TranslationKey;
  /** The voice she said it in, which is the gender of the study she wears. */
  readonly voice: GuideVoice;
  readonly reward: boolean;
  readonly choices: readonly GuideChoiceViewState[];
}

function fill(text: string, names: GuideNames): string {
  return text
    .replaceAll("{avaia}", names.avaia)
    .replaceAll("{bond}", names.bond);
}

export function replyText(
  t: Translate,
  reply: GuideReply,
  seed: number,
  names: GuideNames,
  voice: GuideVoice,
): string {
  const wording = pickVariant(REPLY_KEYS[reply], seed, `reply:${reply}`);
  return fill(t(voiced(wording, voice)), names);
}

export function createGuideLineState(
  node: GuideNodeId,
  seed: number,
  t: Translate,
  names: GuideNames,
  voice: GuideVoice,
  replyVoice: GuideVoice = voice,
): GuideLineViewState {
  const script = GUIDE_NODES[node];
  const wording = pickVariant(script.line, seed, `line:${node}`);
  const key = voiced(wording, voice);
  return {
    node,
    speaker: t("guide.speaker"),
    text: fill(t(key), names),
    key,
    voice,
    reward: script.reward === true,
    choices: script.choices.map((choice) => ({
      reply: choice.reply,
      text: replyText(t, choice.reply, seed, names, replyVoice),
    })),
  };
}

/** Where a reply leads: the next line, or the end of the scene. */
export function followChoice(
  node: GuideNodeId,
  reply: GuideReply,
): GuideChoice["next"] | undefined {
  return GUIDE_NODES[node].choices.find((choice) => choice.reply === reply)
    ?.next;
}
