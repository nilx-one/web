// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { translate } from "../../shell/localization";
import {
  createGuideLineState,
  followChoice,
  GUIDE_NODES,
  GUIDE_OPENING,
  isRecordedGuideLine,
  isSpokenReply,
  pickVariant,
  replyText,
  studyVoice,
  type GuideNodeId,
  type GuideReply,
  type GuideVoice,
} from "./guide-script";

type Key = Parameters<typeof translate>[1];
const uk = (key: Key) => translate("uk-UA", key);
const ru = (key: Key) => translate("ru-RU", key);
const en = (key: Key) => translate("en", key);
const names = { avaia: "xda-shai", bond: "0xda" };
const VOICES: readonly GuideVoice[] = ["feminine", "masculine", "neutral"];
const NODES = Object.keys(GUIDE_NODES) as GuideNodeId[];

describe("xSasha's script", () => {
  it("offers the exclusive line with continue and skip, without granting a reward", () => {
    const line = createGuideLineState(
      GUIDE_OPENING.exclusive,
      0,
      uk,
      names,
      "neutral",
    );
    expect(line.text).toBe("Хочеш ексклюзивне? Я миттю — одразу, як купиш.");
    expect(line.choices.map((choice) => choice.reply)).toEqual([
      "continue",
      "skip",
    ]);
    expect(GUIDE_NODES.exclusive.reward).toBeUndefined();
    expect(isRecordedGuideLine(line.key)).toBe(false);
    expect(followChoice("exclusive", "continue")).toEqual({ end: "done" });
    expect(followChoice("exclusive", "skip")).toEqual({ end: "skipped" });
  });

  it("opens the introduction with her greeting and two replies", () => {
    const line = createGuideLineState(
      GUIDE_OPENING.intro,
      0,
      uk,
      names,
      "feminine",
    );
    expect(line.speaker).toBe("xSasha");
    expect(line.text).toMatch(/зайчик/);
    expect(line.text).toMatch(/Avaia/);
    expect(line.choices.map((choice) => choice.reply)).toEqual([
      "curious",
      "later",
    ]);
  });

  it("never says the same line the same way twice in a row", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const now = createGuideLineState("greeting", seed, uk, names, "neutral");
      const next = createGuideLineState(
        "greeting",
        seed + 1,
        uk,
        names,
        "neutral",
      );
      expect(next.text).not.toBe(now.text);
      expect(next.choices[0]?.text).not.toBe(now.choices[0]?.text);
    }
  });

  it("keeps every wording of a line meaning the same thing", () => {
    const wordings = new Set(
      [0, 1, 2].map(
        (seed) =>
          createGuideLineState("greeting", seed, uk, names, "feminine").text,
      ),
    );
    expect(wordings.size).toBe(3);
    for (const wording of wordings) {
      expect(wording).toMatch(/зайнята/);
      expect(wording).toMatch(/Avaia/);
    }
  });

  it("mirrors the Bond: says her lines in the voice of the study it wears", () => {
    expect(studyVoice("dasha-v2-study")).toBe("feminine");
    expect(studyVoice("dasha-study")).toBe("feminine");
    expect(studyVoice("sky-study")).toBe("masculine");
    expect(studyVoice("kai-study")).toBe("neutral");
    expect(studyVoice(undefined)).toBe("neutral");

    const said = (voice: GuideVoice) =>
      [0, 1, 2].map(
        (seed) => createGuideLineState("greeting", seed, uk, names, voice).text,
      );
    for (const line of said("feminine")) expect(line).toMatch(/зайнята/);
    for (const line of said("masculine")) expect(line).toMatch(/зайнятий/);
    for (const line of said("neutral")) expect(line).not.toMatch(/зайнят/);
  });

  it("has the Bond's own replies share that voice", () => {
    const curious = (voice: GuideVoice, locale: typeof uk) =>
      [0, 1, 2].map((seed) => replyText(locale, "curious", seed, names, voice));
    // Cyrillic has no \b, so a line is compared word by word.
    const words = (lines: readonly string[]) =>
      new Set(
        lines
          .join(" ")
          .toLowerCase()
          .split(/[^\p{L}]+/u),
      );
    expect(words(curious("masculine", uk))).toContain("був");
    expect(words(curious("feminine", uk))).toContain("була");
    expect(words(curious("masculine", ru))).toContain("был");
    expect(words(curious("feminine", ru))).toContain("была");
    for (const locale of [uk, ru]) {
      const said = words(curious("neutral", locale));
      for (const gendered of ["був", "була", "был", "была"]) {
        expect(said).not.toContain(gendered);
      }
    }
  });

  it("has a wording for every voice of every line, in every language", () => {
    const replies = new Set<GuideReply>(
      NODES.flatMap((node) =>
        GUIDE_NODES[node].choices.map((choice) => choice.reply),
      ),
    );
    for (const locale of [en, uk, ru]) {
      for (const voice of VOICES) {
        for (let seed = 0; seed < 6; seed += 1) {
          for (const node of NODES) {
            const line = createGuideLineState(node, seed, locale, names, voice);
            expect(line.text).not.toMatch(/^guide\./);
            expect(line.text).not.toMatch(/[{}]/);
          }
          for (const reply of replies) {
            expect(replyText(locale, reply, seed, names, voice)).not.toMatch(
              /^guide\./,
            );
          }
        }
      }
    }
  });

  it("names the Avaia when she explains how to create it", () => {
    const line = createGuideLineState("howTo", 3, uk, names, "feminine");
    expect(line.text).toContain("xda-shai");
    expect(line.text).toContain("«Створити»");
  });

  it("leads a curious reply to how, a later one to goodbye, and a skip out", () => {
    expect(followChoice("greeting", "curious")).toBe("howTo");
    expect(followChoice("greeting", "later")).toBe("farewell");
    expect(followChoice("greeting", "skip")).toBeUndefined();
    expect(followChoice("howTo", "go")).toEqual({ end: "create" });
    expect(followChoice("farewell", "continue")).toEqual({ end: "later" });
    expect(followChoice("greeting", "thanks")).toBeUndefined();
  });

  it("pays the reward as she says it, then leaves the two of them together", () => {
    const paying = createGuideLineState(
      GUIDE_OPENING.reward,
      0,
      en,
      names,
      "feminine",
    );
    expect(paying.node).toBe("almostForgot");
    expect(paying.reward).toBe(true);
    expect(followChoice("almostForgot", "thanks")).toBe("together");
    expect(followChoice("almostForgot", "skip")).toEqual({ end: "skipped" });
    expect(followChoice("together", "continue")).toEqual({ end: "together" });
  });

  it("cuts a scene short on skip and ends it on a thank-you, whatever was given", () => {
    for (const node of ["almostForgot", "backpackGift", "newGround"] as const) {
      expect(followChoice(node, "skip")).toEqual({ end: "skipped" });
    }
    for (const node of ["backpackGift", "newGround"] as const) {
      expect(followChoice(node, "thanks")).toEqual({ end: "done" });
    }
    // Nothing else in the script is cut short: it has no skip to give.
    expect(followChoice("greeting", "skip")).toBeUndefined();
    expect(followChoice("farewell", "skip")).toBeUndefined();
    expect(followChoice("afterthought", "skip")).toBeUndefined();
  });

  it("turns back for what a skipped reward left unsaid, and hands the wheel over", () => {
    expect(GUIDE_OPENING.afterthought).toBe("afterthought");
    expect(followChoice("afterthought", "continue")).toEqual({
      end: "together",
    });
    const said = (voice: GuideVoice) =>
      [0, 1, 2, 3].map(
        (seed) =>
          createGuideLineState("afterthought", seed, uk, names, voice).text,
      );
    expect(said("feminine")).toContain(
      "Ледь не забула — далі ви вдвох. Я поруч.",
    );
    expect(said("masculine")).toContain(
      "Ледь не забув — далі ви вдвох. Я поруч.",
    );
    for (const line of said("neutral")) expect(line).not.toMatch(/забул|забув/);
    // It pays nothing: the reward was paid, and shown, before she spoke.
    expect(GUIDE_NODES.afterthought.reward).toBeUndefined();
    expect(said("feminine").some((line) => line.includes("xda-shai"))).toBe(
      true,
    );
  });

  it("is sorry to go when put off, in wordings not recorded yet", () => {
    const farewells = (locale: typeof uk) =>
      [0, 1, 2, 3].map((seed) =>
        createGuideLineState("farewell", seed, locale, names, "feminine"),
      );
    expect(
      farewells(uk).filter((line) => /шкода/i.test(line.text)),
    ).toHaveLength(2);
    expect(
      farewells(ru).filter((line) => /жаль/i.test(line.text)),
    ).toHaveLength(2);
    expect(
      farewells(en).filter((line) => /shame|pity/i.test(line.text)),
    ).toHaveLength(2);
    // What was recorded stays heard; the new wordings are only typed out.
    const keys = farewells(uk).map((line) => line.key);
    expect(keys.filter(isRecordedGuideLine)).toEqual([
      "guide.intro.farewell.0",
      "guide.intro.farewell.1",
    ]);
    expect(isRecordedGuideLine("guide.reward.afterthought.1")).toBe(false);
  });

  it("calls the Bond by its pub_dress when she pays it, and nearly forgets to", () => {
    const wordings = (voice: GuideVoice) =>
      [0, 1, 2].map(
        (seed) =>
          createGuideLineState("almostForgot", seed, uk, names, voice).text,
      );
    for (const voice of VOICES) {
      for (const line of wordings(voice)) expect(line).toContain("0xda");
    }
    expect(wordings("feminine")).toContain("Ледь не забула — тримай, 0xda.");
    expect(wordings("masculine")).toContain("Ледь не забув — тримай, 0xda.");
    for (const line of wordings("neutral")) {
      expect(line).not.toMatch(/забул|забув|пішла|пішов/);
    }
  });

  it("only has a person say what they chose out loud", () => {
    expect(isSpokenReply("curious")).toBe(true);
    expect(isSpokenReply("skip")).toBe(false);
    expect(isSpokenReply("continue")).toBe(false);
  });

  it("reaches an ending from every line", () => {
    function ends(node: GuideNodeId, seen: ReadonlySet<GuideNodeId>): boolean {
      return GUIDE_NODES[node].choices.some((choice) =>
        typeof choice.next === "string"
          ? !seen.has(choice.next) &&
            ends(choice.next, new Set([...seen, choice.next]))
          : true,
      );
    }
    for (const node of Object.keys(GUIDE_NODES) as GuideNodeId[]) {
      expect(ends(node, new Set([node]))).toBe(true);
    }
  });

  it("picks deterministically for the same seed", () => {
    expect(pickVariant(["a", "b", "c"], 7, "x")).toBe(
      pickVariant(["a", "b", "c"], 7, "x"),
    );
  });
});
