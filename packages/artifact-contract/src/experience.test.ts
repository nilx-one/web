// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  AVAIA_PICKUP_MAX_TIER,
  awardsFor,
  canPickUp,
  FIND_SEEN_EXPERIENCE,
  ROLL_TABLE,
  type FindAward,
  type FindEvent,
  type FindRoll,
  type Tier,
} from "./index";

function find(tier: Tier, slot = 0): FindRoll {
  const segment = `seg:312346:${298_243 + slot}` as const;
  return {
    artifactId: `art:${segment}:e2961:1:0`,
    segment,
    epoch: "e2961",
    packVersion: 1,
    slot: 0,
    tier,
    experience: ROLL_TABLE.tiers[tier - 1]!.experience,
    placement: { along: 0.5, across: 0 },
  };
}

/** Plays events in order the way a journal would, and sums what each earner got. */
function play(
  roll: FindRoll,
  events: readonly Omit<FindEvent, "artifactId">[],
  recorded: FindEvent[] = [],
) {
  const awards: FindAward[] = [];
  for (const event of events) {
    const paid = awardsFor(roll, event, recorded);
    awards.push(...paid);
    for (const award of paid) {
      recorded.push({
        artifactId: award.artifactId,
        kind: award.kind,
        by: award.earner,
      });
    }
  }
  const total = (earner: "avaia" | "bond") =>
    awards
      .filter((award) => award.earner === earner)
      .reduce((sum, award) => sum + award.experience, 0);
  return { awards, avaia: total("avaia"), bond: total("bond") };
}

describe("who is paid for a find", () => {
  it("pays the sighting to whoever saw it first, once", () => {
    expect(
      play(find(2), [
        { kind: "seen", by: "avaia" },
        { kind: "seen", by: "bond" },
        { kind: "seen", by: "avaia" },
      ]),
    ).toMatchObject({ avaia: FIND_SEEN_EXPERIENCE, bond: 0 });
    expect(
      play(find(2), [
        { kind: "seen", by: "bond" },
        { kind: "seen", by: "avaia" },
      ]),
    ).toMatchObject({ avaia: 0, bond: FIND_SEEN_EXPERIENCE });
  });

  it("pays the pick-up its tier, to whoever picked it up, once", () => {
    expect(
      play(find(3), [
        { kind: "seen", by: "avaia" },
        { kind: "picked_up", by: "avaia" },
        { kind: "picked_up", by: "avaia" },
        { kind: "picked_up", by: "bond" },
      ]),
    ).toMatchObject({ avaia: FIND_SEEN_EXPERIENCE + 60, bond: 0 });
  });

  it("leaves a rare find the Avaia saw for the Bond to pick up", () => {
    const rare = find(6);
    expect(canPickUp(rare, "avaia")).toBe(false);
    expect(canPickUp(rare, "bond")).toBe(true);
    expect(
      play(rare, [
        { kind: "seen", by: "avaia" },
        { kind: "picked_up", by: "avaia" },
        { kind: "picked_up", by: "bond" },
      ]),
    ).toMatchObject({ avaia: FIND_SEEN_EXPERIENCE, bond: 1000 });
  });

  it("counts picking up an unseen find as seeing it too", () => {
    const { awards, bond } = play(find(5), [{ kind: "picked_up", by: "bond" }]);
    expect(awards.map((award) => award.kind)).toEqual(["seen", "picked_up"]);
    expect(bond).toBe(FIND_SEEN_EXPERIENCE + 400);
  });

  it("lets the Avaia pick up every tier up to its limit and none above", () => {
    for (const rate of ROLL_TABLE.tiers) {
      expect(canPickUp(find(rate.tier), "avaia")).toBe(
        rate.tier <= AVAIA_PICKUP_MAX_TIER,
      );
    }
  });

  it("pays from 10 to 1000 for a pick-up", () => {
    const pickUps = ROLL_TABLE.tiers.map(
      (rate) =>
        awardsFor(find(rate.tier), { kind: "picked_up", by: "bond" }, [
          { artifactId: find(rate.tier).artifactId, kind: "seen", by: "bond" },
        ])[0]?.experience,
    );
    expect(pickUps).toEqual([10, 25, 60, 150, 400, 1000]);
  });

  it("does not let one find's journal stand for another's", () => {
    const one = find(1, 0);
    const other = find(1, 1);
    const recorded: FindEvent[] = [
      { artifactId: other.artifactId, kind: "seen", by: "avaia" },
      { artifactId: other.artifactId, kind: "picked_up", by: "avaia" },
    ];
    expect(
      play(one, [{ kind: "picked_up", by: "avaia" }], recorded),
    ).toMatchObject({ avaia: FIND_SEEN_EXPERIENCE + 10 });
  });

  it("mints nothing more when the whole journal is replayed", () => {
    const roll = find(4);
    const events = [
      { kind: "seen", by: "avaia" },
      { kind: "picked_up", by: "bond" },
    ] as const;
    const recorded: FindEvent[] = [];
    const first = play(roll, events, recorded);
    const again = play(roll, events, recorded);
    expect(first).toMatchObject({ avaia: 10, bond: 150 });
    expect(again.awards).toEqual([]);
  });
});
