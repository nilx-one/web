// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { translate } from "../../shell/localization";
import {
  createGuideLineState,
  followChoice,
  GUIDE_NODES,
  GUIDE_OPENING,
  isSpokenReply,
  pickVariant,
  type GuideNodeId,
} from "./guide-script";

const uk = (key: Parameters<typeof translate>[1]) => translate("uk-UA", key);
const en = (key: Parameters<typeof translate>[1]) => translate("en", key);
const names = { avaia: "xda-shai" };

describe("0xda-sha's script", () => {
  it("opens the introduction with her greeting and three replies", () => {
    const line = createGuideLineState(GUIDE_OPENING.intro, 0, uk, names);
    expect(line.speaker).toBe("0xda-sha");
    expect(line.text).toMatch(/зайчик/);
    expect(line.text).toMatch(/Avaia/);
    expect(line.choices.map((choice) => choice.reply)).toEqual([
      "curious",
      "later",
      "skip",
    ]);
    expect(line.choices[2]?.text).toBe("(пропустити)");
  });

  it("never says the same line the same way twice in a row", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const now = createGuideLineState("greeting", seed, uk, names);
      const next = createGuideLineState("greeting", seed + 1, uk, names);
      expect(next.text).not.toBe(now.text);
      expect(next.choices[0]?.text).not.toBe(now.choices[0]?.text);
    }
  });

  it("keeps every wording of a line meaning the same thing", () => {
    const wordings = new Set(
      [0, 1, 2].map(
        (seed) => createGuideLineState("greeting", seed, uk, names).text,
      ),
    );
    expect(wordings.size).toBe(3);
    for (const wording of wordings) {
      expect(wording).toMatch(/зайн?ята/);
      expect(wording).toMatch(/Avaia/);
    }
  });

  it("names the Avaia when she explains how to create it", () => {
    const line = createGuideLineState("howTo", 3, uk, names);
    expect(line.text).toContain("xda-shai");
    expect(line.text).toContain("«Створити»");
  });

  it("leads a curious reply to how, a later one to goodbye, and a skip out", () => {
    expect(followChoice("greeting", "curious")).toBe("howTo");
    expect(followChoice("greeting", "later")).toBe("farewell");
    expect(followChoice("greeting", "skip")).toEqual({ end: "skipped" });
    expect(followChoice("howTo", "go")).toEqual({ end: "create" });
    expect(followChoice("farewell", "continue")).toEqual({ end: "later" });
    expect(followChoice("greeting", "thanks")).toBeUndefined();
  });

  it("pays the reward as she says it, then leaves the two of them together", () => {
    const grow = createGuideLineState(GUIDE_OPENING.reward, 0, en, names);
    expect(grow.reward).toBe(true);
    expect(grow.text).toMatch(/[Gg]rowing/);
    expect(followChoice("grow", "thanks")).toBe("together");
    expect(followChoice("together", "continue")).toEqual({ end: "together" });
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
