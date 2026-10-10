// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import { translate, type Translate } from "../../shell/localization";
import {
  EMPTY_PROGRESSION,
  progressionStanding,
} from "../progression/progression";
import { guideResultToast } from "./guide-result-toast";

const t: Translate = (key) => translate("en", key);
const names = { bond: "0x1test", avaia: "Avaia" };

describe("scene result notifications", () => {
  it.each(["done", "create", "together", "later", "skipped"] as const)(
    "leaves an actionable intro result for %s",
    (outcome) => {
      const toast = guideResultToast("1", "intro", outcome, {}, t, names);
      expect(toast.description).toContain("Avaia");
      if (outcome === "create") {
        expect(toast.description).toMatch(/3D model.*name.*save/);
      }
      if (outcome === "later") expect(toast.description).toContain("postponed");
      if (outcome === "skipped") expect(toast.description).toContain("skipped");
    },
  );
  it("retains both committed gifts even when the scene was skipped", () => {
    const toast = guideResultToast(
      "2",
      "backpack",
      "skipped",
      {
        gift: {
          key: "bags",
          title: "Backpacks",
          items: [
            { subject: "bond", text: "Backpack · 40 cells" },
            { subject: "avaia", text: "Backpack · 40 cells" },
          ],
        },
      },
      t,
      names,
    );
    expect(toast.title).toBe("Backpacks");
    expect(toast.description).toBe(
      "0x1test: Backpack · 40 cells · Avaia: Backpack · 40 cells",
    );
  });
  it("summarizes XP, actual level transitions and next step without paying again", () => {
    const before = progressionStanding(EMPTY_PROGRESSION, {
      avaiaConfigured: false,
    });
    const after = progressionStanding(EMPTY_PROGRESSION, {
      avaiaConfigured: true,
    });
    const reward = {
      achievement: "avaia-configured" as const,
      before,
      after,
      next: "download" as const,
    };
    const original = JSON.stringify(reward);
    const toast = guideResultToast(
      "3",
      "reward",
      "together",
      { reward },
      t,
      names,
    );
    expect(toast.description).toContain(t("achievement.nextDownload"));
    for (const subject of ["bond", "avaia"] as const) {
      if (after[subject].level > before[subject].level)
        expect(toast.description).toContain(names[subject]);
    }
    expect(JSON.stringify(reward)).toBe(original);
  });
  it("does not invent gifts or achievements for an empty result", () => {
    expect(
      guideResultToast("4", "reward", "done", {}, t, names).description,
    ).toBe("");
  });
});
