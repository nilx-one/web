// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { FindEvent, FindRoll, Tier } from "@nilx-one/artifact-contract";
import { describe, expect, it } from "vitest";

import { worldAwardsForFind } from "./use-find-loop";

function find(tier: Tier): FindRoll {
  return {
    artifactId: "art:seg:312346:298243:e2961:1:0",
    segment: "seg:312346:298243",
    epoch: "e2961",
    packVersion: 1,
    slot: 0,
    tier,
    experience: [0, 10, 25, 60, 150, 400, 1000][tier]!,
    placement: { along: 0.5, across: 0.2 },
  };
}

describe("worldAwardsForFind", () => {
  it("lets the Avaia see and pick up a common find", () => {
    const roll = find(2);
    const awards = worldAwardsForFind(roll, "avaia", [], 1234);

    expect(
      awards.map(({ record }) => ({
        kind: record.kind,
        earner: record.earner,
        tier: record.tier,
        subject: record.subject,
        at: record.at,
      })),
    ).toEqual([
      {
        kind: "find_seen",
        earner: "avaia",
        tier: undefined,
        subject: roll.artifactId,
        at: 1234,
      },
      {
        kind: "find_picked_up",
        earner: "avaia",
        tier: 2,
        subject: roll.artifactId,
        at: 1234,
      },
    ]);
    expect(awards.every((award) => award.find === roll)).toBe(true);
  });

  it("only sees a find the pick-up setting leaves behind", () => {
    for (const by of ["avaia", "bond"] as const) {
      expect(
        worldAwardsForFind(find(1), by, [], 1234, false).map(({ record }) => [
          record.kind,
          record.earner,
        ]),
      ).toEqual([["find_seen", by]]);
    }
  });

  it("leaves a rare find as a sighting when the Avaia finds it", () => {
    const roll = find(5);

    expect(
      worldAwardsForFind(roll, "avaia", [], 1234).map(
        ({ record }) => record.kind,
      ),
    ).toEqual(["find_seen"]);
  });

  it("lets the Bond pick up a rare find and counts an unseen one as seen", () => {
    const roll = find(5);

    expect(
      worldAwardsForFind(roll, "bond", [], 1234).map(({ record }) => [
        record.kind,
        record.earner,
        record.tier,
      ]),
    ).toEqual([
      ["find_seen", "bond", undefined],
      ["find_picked_up", "bond", 5],
    ]);
  });

  it("never mints the same sighting or pick-up twice", () => {
    const roll = find(5);
    const seen: FindEvent = {
      artifactId: roll.artifactId,
      kind: "seen",
      by: "avaia",
    };
    const picked: FindEvent = {
      artifactId: roll.artifactId,
      kind: "picked_up",
      by: "bond",
    };

    expect(worldAwardsForFind(roll, "avaia", [seen], 1234)).toEqual([]);
    expect(
      worldAwardsForFind(roll, "bond", [seen], 1234).map(
        ({ record }) => record.kind,
      ),
    ).toEqual(["find_picked_up"]);
    expect(worldAwardsForFind(roll, "bond", [seen, picked], 1234)).toEqual([]);
  });
});
