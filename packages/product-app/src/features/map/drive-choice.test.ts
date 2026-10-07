// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

/**
 * The same cases `nilx-one/ai` tests `ChoiceMenu` against. `drive-choice.json`
 * is that repository's fixture, copied byte for byte; it is changed there
 * first. Two readings of one rule cannot drift apart while both hold.
 */

import { describe, expect, it } from "vitest";

import {
  CHOICE_SYSTEM_PROMPT,
  choiceGrammar,
  choicePrompt,
  isWordable,
  readChoice,
  type DriveChoose,
} from "./drive-choice";
import fixture from "./drive-choice.json";

const asChoose = (command: unknown) => command as DriveChoose;

describe("a drive menu put to a model", () => {
  it("tells her what she is the way ai does", () => {
    expect(fixture.system_prompt).toBe(CHOICE_SYSTEM_PROMPT);
  });

  for (const shared of fixture.cases) {
    it(`words, constrains and reads back: ${shared.name}`, () => {
      const choose = asChoose(shared.command);
      expect(isWordable(choose)).toBe(true);
      expect(choicePrompt(choose)).toBe(shared.prompt);
      expect(choiceGrammar(choose)).toBe(shared.grammar);
      for (const [decoded, index] of Object.entries(shared.accepts)) {
        expect(readChoice(choose, decoded)).toBe(index);
      }
      for (const decoded of shared.refuses) {
        expect(readChoice(choose, decoded)).toBeNull();
      }
    });
  }

  for (const refused of fixture.refused_menus) {
    it(`never words a menu outside the vocabulary: ${refused.name}`, () => {
      const command = refused.command as Record<string, unknown>;
      // A member Core never sends, or not a choose command at all, does not
      // get this far: the Core adapter refuses it while decoding.
      const outside =
        command.do !== "choose" ||
        (command.menu as Record<string, unknown>[]).some((option) =>
          Object.keys(option).some(
            (key) =>
              !["index", "action", "kind", "reach", "feeling"].includes(key),
          ),
        );
      expect(outside || !isWordable(asChoose(command))).toBe(true);
    });
  }
});
