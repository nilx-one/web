// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { importHistoryKey, type AwardRecord, type Commitment } from "./commitment";
import {
  rebasePendingAwards,
  recordedFindEvents,
  type PendingCommittedAward,
} from "./committed-journal";

const commitment = (char: string): Commitment =>
  `xp:${char.repeat(43)}` as Commitment;

const walked = (subject: string, at: number): AwardRecord => ({
  kind: "zone_walked",
  earner: "bond",
  subject,
  at,
});

describe("rebasePendingAwards", () => {
  it("rebuilds every descendant on the server head in order", async () => {
    const key = await importHistoryKey(new Uint8Array(32).fill(9));
    const oldFirst = commitment("a");
    const oldSecond = commitment("b");
    const serverHead = commitment("s");
    const chain = "ch:phone123";
    const pending: PendingCommittedAward[] = [
      {
        id: oldFirst,
        parent: null,
        chain,
        record: walked("cell:first", 1000),
      },
      {
        id: oldSecond,
        parent: oldFirst,
        chain,
        record: walked("cell:second", 2000),
      },
    ];

    const rebased = await rebasePendingAwards(
      key,
      chain,
      serverHead,
      pending,
    );

    expect(rebased).toHaveLength(2);
    expect(rebased[0]?.parent).toBe(serverHead);
    expect(rebased[1]?.parent).toBe(rebased[0]?.id);
    expect(rebased.map((award) => award.chain)).toEqual([chain, chain]);
    expect(rebased.map((award) => award.record)).toEqual(
      pending.map((award) => award.record),
    );
    expect(rebased[0]?.id).not.toBe(oldFirst);
    expect(rebased[1]?.id).not.toBe(oldSecond);
  });
});

describe("recordedFindEvents", () => {
  it("folds a kept pickup into seen + picked-up without inventing protocol state", () => {
    const artifactId = "art:seg:312346:298243:e2961:1:0" as const;
    const pickup: PendingCommittedAward = {
      id: commitment("p"),
      parent: null,
      chain: "ch:phone123",
      record: {
        kind: "find_picked_up",
        earner: "bond",
        tier: 5,
        subject: artifactId,
        at: 1000,
      },
    };

    expect(recordedFindEvents({ history: [pickup] })).toEqual([
      { artifactId, kind: "seen", by: "bond" },
      { artifactId, kind: "picked_up", by: "bond" },
    ]);
  });
});
