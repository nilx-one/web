// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  importHistoryKey,
  type AwardRecord,
  type Commitment,
} from "./commitment";
import {
  foldCommittedJournal,
  leadChangeForKeptAward,
  rebasePendingAwards,
  recordedFindEvents,
  type CommittedJournalSnapshot,
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

    const rebased = await rebasePendingAwards(key, chain, serverHead, pending);

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

    expect(recordedFindEvents({ history: [pickup], pending: [] })).toEqual([
      { artifactId, kind: "seen", by: "bond" },
      { artifactId, kind: "picked_up", by: "bond" },
    ]);
  });

  it("counts awards still pending, so an offline find is not earned twice", () => {
    const artifactId = "art:seg:312346:298243:e2961:1:0" as const;
    const award = (
      id: string,
      kind: "find_seen" | "find_picked_up",
    ): PendingCommittedAward => ({
      id: commitment(id),
      parent: null,
      chain: "ch:phone123",
      record: {
        kind,
        earner: "avaia",
        ...(kind === "find_picked_up" ? { tier: 2 } : {}),
        subject: artifactId,
        at: 1000,
      },
    });

    // The Avaia saw and picked up a tier 2 find while offline; nothing is kept
    // yet. A Bond driving through the same segment must find it recorded.
    expect(
      recordedFindEvents({
        history: [],
        pending: [award("s", "find_seen"), award("p", "find_picked_up")],
      }),
    ).toEqual([
      { artifactId, kind: "seen", by: "avaia" },
      { artifactId, kind: "picked_up", by: "avaia" },
    ]);
  });
});

describe("leadChangeForKeptAward", () => {
  const rareFind = {
    artifactId: "art:seg:312346:298243:e2961:1:0",
    segment: "seg:312346:298243",
    epoch: "e2961",
    packVersion: 1,
    slot: 0,
    tier: 5,
    experience: 400,
    placement: { along: 0.5, across: 0.2 },
  } as const;
  const commonFind = { ...rareFind, tier: 2, experience: 25 } as const;

  const snapshot = (
    leads: CommittedJournalSnapshot["leads"] = [],
  ): Pick<CommittedJournalSnapshot, "leads"> => ({ leads });

  it("notes a rare lead in the same keep transaction", () => {
    const seen: PendingCommittedAward = {
      id: commitment("l"),
      parent: null,
      chain: "ch:phone123",
      record: {
        kind: "find_seen",
        earner: "avaia",
        subject: rareFind.artifactId,
        at: 2000,
      },
      find: rareFind,
    };

    expect(leadChangeForKeptAward(snapshot(), seen)).toEqual({
      kind: "note",
      lead: {
        artifactId: rareFind.artifactId,
        segment: rareFind.segment,
        epoch: rareFind.epoch,
        tier: 5,
        seenAt: 2000,
      },
    });
  });

  it("does not turn a common sighting into a lead", () => {
    const seen: PendingCommittedAward = {
      id: commitment("m"),
      parent: null,
      chain: "ch:phone123",
      record: {
        kind: "find_seen",
        earner: "avaia",
        subject: commonFind.artifactId,
        at: 2000,
      },
      find: commonFind,
    };

    expect(leadChangeForKeptAward(snapshot(), seen)).toBeUndefined();
  });

  it("closes an existing lead with the accepted pickup", () => {
    const lead = {
      artifactId: rareFind.artifactId,
      segment: rareFind.segment,
      epoch: rareFind.epoch,
      tier: 5,
      seenAt: 1000,
    } as const;
    const pickup: PendingCommittedAward = {
      id: commitment("n"),
      parent: null,
      chain: "ch:phone123",
      record: {
        kind: "find_picked_up",
        earner: "bond",
        tier: 5,
        subject: rareFind.artifactId,
        at: 3000,
      },
      find: rareFind,
    };

    expect(leadChangeForKeptAward(snapshot([lead]), pickup)).toEqual({
      kind: "close",
      artifactId: rareFind.artifactId,
    });
    expect(leadChangeForKeptAward(snapshot(), pickup)).toBeUndefined();
  });
});

describe("the inventory in the journal", () => {
  it("keeps the latest state and every find already put in", () => {
    const snapshot = foldCommittedJournal(
      { chain: "ch:phone123", head: null },
      [
        { type: "inventory.state", state: '{"seeds":"0"}', pickedUp: "art:a" },
        { type: "inventory.state", state: '{"seeds":"5"}' },
        {
          type: "inventory.state",
          state: '{"seeds":"5","x":1}',
          pickedUp: "art:b",
        },
      ],
    );
    expect(snapshot.inventory.state).toBe('{"seeds":"5","x":1}');
    expect([...snapshot.inventory.pickedUp]).toEqual(["art:a", "art:b"]);
  });

  it("starts empty", () => {
    const snapshot = foldCommittedJournal(
      { chain: "ch:phone123", head: null },
      [],
    );
    expect(snapshot.inventory.state).toBe("");
    expect(snapshot.inventory.pickedUp.size).toBe(0);
  });
});
