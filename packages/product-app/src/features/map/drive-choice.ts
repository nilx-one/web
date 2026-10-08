// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AvaiaDriveCommand,
  AvaiaDriveMenuOption,
} from "@nilx-one/application";

/**
 * A choice the Avaia's drive in Core offers, put to a local model and read
 * back: the port of `src/choice.rs` in `nilx-one/ai`, held to the same cases
 * by `drive-choice.json`, which that repository owns and this one copies byte
 * for byte.
 *
 * A model points at a numbered option; it never names a target. Anything this
 * refuses is no answer, and the drive's own pick stands.
 */

export type DriveChoose = Extract<AvaiaDriveCommand, { do: "choose" }>;

/** What she is told she is, before every choice. */
export const CHOICE_SYSTEM_PROMPT =
  "You are Avaia, walking a city on your own. Choose what you do next from the numbered options. Answer with the number of one option and nothing else.";

const DISTRACTION = new Set(["carry_on", "glance", "pick_up"]);
const OUTING = new Set(["stay", "go", "wander", "home"]);
const CURIOSITY = new Set(["stay", "study"]);
const KIND = /^[a-z][a-z_]{0,31}$/;

/**
 * Whether a menu is one the closed vocabulary words: two options or more,
 * numbered 0, 1, 2… in order, each an action of its kind of choice, every
 * kind a code. Nothing else is ever put into a prompt.
 */
export function isWordable(choose: DriveChoose): boolean {
  const actions =
    choose.what === "distraction"
      ? DISTRACTION
      : choose.what === "curiosity"
        ? CURIOSITY
        : OUTING;
  return (
    choose.menu.length >= 2 &&
    Number.isInteger(choose.default) &&
    choose.default >= 0 &&
    choose.default < choose.menu.length &&
    choose.menu.every(
      (option, index) =>
        option.index === index &&
        actions.has(option.action) &&
        (option.kind === undefined || KIND.test(option.kind)),
    )
  );
}

function withArticle(kind: string): string {
  const words = kind.replaceAll("_", " ");
  return `${/^[aeiou]/.test(words) ? "an" : "a"} ${words}`;
}

function wording(option: AvaiaDriveMenuOption): string {
  const thing =
    option.kind === undefined ? undefined : withArticle(option.kind);
  let words: string;
  switch (option.action) {
    case "carry_on":
      words = "carry on where you were going";
      break;
    case "glance":
      words = `step aside to look at ${thing ?? "it"}`;
      break;
    case "pick_up":
      words = "step aside to pick up a find";
      break;
    case "stay":
      words = "stay here";
      break;
    case "go":
      words = `go out to ${thing ?? "a place"}`;
      break;
    case "wander":
      words = "wander a short way along the paths";
      break;
    case "home":
      words = "go home";
      break;
    case "study":
      words = `go and study ${thing ?? "a landmark"}`;
      break;
  }
  const notes: string[] = [];
  if (option.action !== "glance" && option.reach !== undefined) {
    notes.push(option.reach);
  }
  if (option.feeling !== undefined) {
    notes.push(
      {
        new: "new to you",
        known: "you know it",
        fond: "you are fond of it",
        loved: "you love it",
      }[option.feeling],
    );
  }
  return notes.length === 0 ? words : `${words} (${notes.join(", ")})`;
}

/** The user turn: where she is, then one line per option. */
export function choicePrompt(choose: DriveChoose): string {
  const situation =
    choose.what === "outing"
      ? "You are standing, rested enough to go out."
      : choose.what === "curiosity"
        ? "You are standing with time to spare, and landmarks from your notebook come to mind."
        : choose.heading === "tap"
          ? "You are walking to a place your owner chose for you, and you pass something."
          : choose.heading === "home"
            ? "You are walking home, tired, and you pass something."
            : "You are walking on your own, and you pass something.";
  return [
    situation,
    "Options:",
    ...choose.menu.map((option) => `${option.index}: ${wording(option)}`),
    "Answer with one number.",
  ].join("\n");
}

/** An EBNF grammar admitting exactly the offered numbers. */
export function choiceGrammar(choose: DriveChoose): string {
  return `root ::= ${choose.menu.map((option) => `"${option.index}"`).join(" | ")}\n`;
}

/**
 * Reads one decode back as an offered index, or `null`. Surrounding
 * whitespace and the empty thinking block the pinned runtime writes are
 * ignored; nothing else is repaired.
 */
export function readChoice(
  choose: DriveChoose,
  decoded: string,
): number | null {
  const start = decoded.trimStart();
  const empty = /^<think>\s*<\/think>/u.exec(start);
  const text = (empty === null ? decoded : start.slice(empty[0].length)).trim();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) return null;
  const index = Number(text);
  return Number.isSafeInteger(index) && index < choose.menu.length
    ? index
    : null;
}
