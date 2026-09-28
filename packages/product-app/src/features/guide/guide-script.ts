// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { Translate, TranslationKey } from "../../shell/localization";
import type { GuideShot } from "./guide-stage";

/**
 * 0xda-sha's scenes, as a small dialogue graph.
 *
 * A scene is presentation and nothing else: what she says creates no
 * Interaction, completes no BondChain and asserts nothing about any Bond. The
 * one thing a scene may pay is an achievement the product already priced —
 * she only says it out loud.
 */
export type GuideSceneId = "intro" | "reward";

export type GuideNodeId =
  "greeting" | "howTo" | "farewell" | "grow" | "together";

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

export interface GuideChoice {
  readonly reply: GuideReply;
  readonly next: GuideNodeId | { readonly end: GuideOutcome };
}

export interface GuideNode {
  /** One line in every wording it has. */
  readonly line: readonly TranslationKey[];
  readonly shot: GuideShot;
  /** The line is said with the achievement the scene is paying beside it. */
  readonly reward?: true;
  readonly choices: readonly GuideChoice[];
}

export const GUIDE_OPENING: Readonly<Record<GuideSceneId, GuideNodeId>> = {
  intro: "greeting",
  reward: "grow",
};

export const GUIDE_NODES: Readonly<Record<GuideNodeId, GuideNode>> = {
  greeting: {
    line: [
      "guide.intro.greeting.0",
      "guide.intro.greeting.1",
      "guide.intro.greeting.2",
    ],
    shot: "dasha",
    choices: [
      { reply: "curious", next: "howTo" },
      { reply: "later", next: "farewell" },
      { reply: "skip", next: { end: "skipped" } },
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
  grow: {
    line: ["guide.reward.grow.0", "guide.reward.grow.1", "guide.reward.grow.2"],
    shot: "reward",
    reward: true,
    choices: [
      { reply: "thanks", next: "together" },
      { reply: "skip", next: { end: "done" } },
    ],
  },
  together: {
    line: ["guide.reward.together.0", "guide.reward.together.1"],
    shot: "two-shot",
    choices: [{ reply: "continue", next: { end: "together" } }],
  },
};

const REPLY_KEYS: Readonly<Record<GuideReply, readonly TranslationKey[]>> = {
  curious: [
    "guide.choice.curious.0",
    "guide.choice.curious.1",
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
}

export interface GuideChoiceViewState {
  readonly reply: GuideReply;
  readonly text: string;
}

export interface GuideLineViewState {
  readonly node: GuideNodeId;
  readonly speaker: string;
  readonly text: string;
  readonly reward: boolean;
  readonly choices: readonly GuideChoiceViewState[];
}

function fill(text: string, names: GuideNames): string {
  return text.replaceAll("{avaia}", names.avaia);
}

export function replyText(
  t: Translate,
  reply: GuideReply,
  seed: number,
  names: GuideNames,
): string {
  return fill(t(pickVariant(REPLY_KEYS[reply], seed, `reply:${reply}`)), names);
}

export function createGuideLineState(
  node: GuideNodeId,
  seed: number,
  t: Translate,
  names: GuideNames,
): GuideLineViewState {
  const script = GUIDE_NODES[node];
  return {
    node,
    speaker: t("guide.speaker"),
    text: fill(t(pickVariant(script.line, seed, `line:${node}`)), names),
    reward: script.reward === true,
    choices: script.choices.map((choice) => ({
      reply: choice.reply,
      text: replyText(t, choice.reply, seed, names),
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
