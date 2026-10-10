// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { StatusToastItem } from "@nilx-one/ui";
import type { Translate } from "../../shell/localization";
import { ACHIEVEMENTS } from "../progression/progression";
import type { GuideNames, GuideOutcome, GuideSceneId } from "./guide-script";
import type { GuidePlayOptions } from "./use-guide-cutscene";

/** Presentation of facts already committed upstream; closing a scene grants nothing. */
export function guideResultToast(
  id: string,
  scene: GuideSceneId,
  outcome: GuideOutcome,
  result: GuidePlayOptions,
  t: Translate,
  names: GuideNames,
): StatusToastItem {
  const lines: string[] = [];
  let title = t("guide.result.title");
  if (scene === "intro") {
    lines.push(
      t(
        outcome === "later"
          ? "guide.result.later"
          : outcome === "skipped"
            ? "guide.result.skipped"
            : "guide.result.create",
      ),
    );
  }
  if (result.gift !== undefined) {
    title = result.gift.title;
    for (const item of result.gift.items)
      lines.push(`${names[item.subject]}: ${item.text}`);
  }
  if (result.reward !== undefined) {
    const reward = result.reward;
    title = t(
      reward.achievement === "avaia-configured"
        ? "achievement.avaiaConfigured"
        : "achievement.avaiaModelDownloaded",
    );
    const achievement = ACHIEVEMENTS[reward.achievement];
    for (const subject of ["bond", "avaia"] as const) {
      const xp = subject === "bond" ? achievement.bondXp : achievement.avaiaXp;
      if (xp > 0)
        lines.push(
          t(
            subject === "bond" ? "achievement.bondXp" : "achievement.avaiaXp",
          ).replace("{xp}", String(xp)),
        );
      if (reward.after[subject].level > reward.before[subject].level) {
        lines.push(
          t("achievement.level")
            .replace("{name}", names[subject])
            .replace("{level}", String(reward.after[subject].level)),
        );
      }
    }
    if (reward.next === "download") lines.push(t("achievement.nextDownload"));
  }
  return { id, kind: "active", title, description: lines.join(" · ") };
}
