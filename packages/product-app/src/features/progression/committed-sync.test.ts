// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CommitAwardsResult,
  CommittedAward,
  CommittedAwardAccessPort,
} from "@nilx-one/application";
import type { FindRoll } from "@nilx-one/artifact-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./committed-journal", () => ({
  closeCommittedLead: vi.fn(),
  dropCommittedAward: vi.fn(),
  keepCommittedAward: vi.fn(),
  noteCommittedLead: vi.fn(),
  queueCommittedAward: vi.fn(),
  readCommittedJournal: vi.fn(),
  rebaseCommittedAwards: vi.fn(),
  subscribeCommittedJournal: vi.fn(() => () => undefined),
}));

vi.mock("./progression", () => ({
  notePublishedExperience: vi.fn((progression) => progression),
  progressionSnapshot: vi.fn(),
  subscribeProgression: vi.fn(() => () => undefined),
  updateProgression: vi.fn(),
}));

import {
  closeCommittedLead,
  dropCommittedAward,
  keepCommittedAward,
  noteCommittedLead,
  readCommittedJournal,
  rebaseCommittedAwards,
  type CommittedJournalSnapshot,
  type PendingCommittedAward,
} from "./committed-journal";
import { flushCommittedAwards, type CommittedWorldEvent } from "./committed-sync";
import {
  progressionSnapshot,
  type Progression,
} from "./progression";

const READY_PROGRESSION: Progression = {
  bondXp: 0,
  avaiaXp: 0,
  deviceAchievements: [],
  settingsHintSeen: false,
  publishedBondXp: 0,
  publishedAvaiaXp: 0,
  pendingEvents: [],
  carrySubmitted: true,
};

const id = (char: string) => `xp:${char.repeat(43)}` as `xp:${string}`;

const commonFind: FindRoll = {
  artifactId: "art:seg:312346:298243:e2961:1:0",
  segment: "seg:312346:298243",
  epoch: "e2961",
  packVersion: 1,
  slot: 0,
  tier: 2,
  experience: 25,
  placement: { along: 0.5, across: 0.2 },
};

const rareFind: FindRoll = {
  ...commonFind,
  artifactId: "art:seg:313806:298243:e2961:1:0",
  segment: "seg:313806:298243",
  tier: 5,
  experience: 400,
};

function award(
  commitment: `xp:${string}`,
  record: PendingCommittedAward["record"],
  find?: FindRoll,
  parent: `xp:${string}` | null = null,
): PendingCommittedAward {
  return {
    id: commitment,
    parent,
    chain: "ch:phone123",
    record,
    ...(find === undefined ? {} : { find }),
  };
}

function accepted(
  sent: readonly CommittedAward[],
  outcome: "accepted" | "duplicate" = "accepted",
): CommitAwardsResult {
  return {
    kind: "committed",
    experience: { bondXp: 25, avaiaXp: 35 },
    results: sent.map((item) => ({
      id: item.id,
      outcome: { kind: outcome },
    })),
  };
}

function answered(
  sent: readonly CommittedAward[],
  outcome:
    | { readonly kind: "taken" }
    | { readonly kind: "already-yours" }
    | { readonly kind: "capped" }
    | { readonly kind: "too-many-chains" }
    | { readonly kind: "behind"; readonly head: `xp:${string}` | null },
): CommitAwardsResult {
  return {
    kind: "committed",
    experience: { bondXp: 25, avaiaXp: 35 },
    results: sent.map((item) => ({ id: item.id, outcome })),
  };
}

function access(
  commit: (
    awards: readonly CommittedAward[],
  ) => Promise<CommitAwardsResult>,
): CommittedAwardAccessPort {
  return {
    commitAwards: vi.fn(commit),
    readClaims: vi.fn(async () => ({ kind: "read", epoch: 2961, claims: [] })),
  };
}

let pending: PendingCommittedAward[] = [];

function snapshot(): CommittedJournalSnapshot {
  return {
    chain: "ch:phone123",
    head: null,
    pending: [...pending],
    history: [],
    leads: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  vi.mocked(progressionSnapshot).mockReturnValue(READY_PROGRESSION);
  vi.mocked(readCommittedJournal).mockImplementation(async () => snapshot());
  vi.mocked(keepCommittedAward).mockImplementation(async (_owner, commitment) => {
    const first = pending[0];
    if (first === undefined || first.id !== commitment) return undefined;
    pending = pending.slice(1);
    return first;
  });
  vi.mocked(dropCommittedAward).mockImplementation(async (_owner, commitment) => {
    const first = pending[0];
    if (first === undefined || first.id !== commitment) return undefined;
    pending = pending.slice(1);
    return first;
  });
  vi.mocked(rebaseCommittedAwards).mockImplementation(async () => {
    pending = [];
  });
  vi.mocked(closeCommittedLead).mockResolvedValue(undefined);
  vi.mocked(noteCommittedLead).mockResolvedValue(undefined);
});

describe("flushCommittedAwards", () => {
  it("commits a common Avaia sighting and pick-up in chain order", async () => {
    const seen = award(
      id("a"),
      {
        kind: "find_seen",
        earner: "avaia",
        subject: commonFind.artifactId,
        at: 1000,
      },
      commonFind,
    );
    const pickup = award(
      id("b"),
      {
        kind: "find_picked_up",
        earner: "avaia",
        tier: 2,
        subject: commonFind.artifactId,
        at: 1000,
      },
      commonFind,
      seen.id,
    );
    pending = [seen, pickup];
    const port = access(async (sent) => accepted(sent));
    const events: CommittedWorldEvent[] = [];

    await flushCommittedAwards("0x0sky", port, (event) => events.push(event));

    expect(port.commitAwards).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(port.commitAwards).mock.calls;
    expect(calls[0]?.[0][0]).toMatchObject({
      id: seen.id,
      kind: "find_seen",
      earner: "avaia",
    });
    expect(calls[1]?.[0][0]).toMatchObject({
      id: pickup.id,
      parent: seen.id,
      kind: "find_picked_up",
      earner: "avaia",
      tier: 2,
    });
    expect(calls[1]?.[0][0]).not.toHaveProperty("artifactId");
    expect(events.map((event) => event.kind)).toEqual([
      "find-seen",
      "find-kept",
    ]);
    expect(pending).toEqual([]);
  });

  it("keeps a rare sighting as a lead only after the service accepts it", async () => {
    const seen = award(
      id("c"),
      {
        kind: "find_seen",
        earner: "avaia",
        subject: rareFind.artifactId,
        at: 2000,
      },
      rareFind,
    );
    pending = [seen];
    const port = access(async (sent) => accepted(sent));

    await flushCommittedAwards("0x0sky", port);

    expect(noteCommittedLead).toHaveBeenCalledWith("0x0sky", {
      artifactId: rareFind.artifactId,
      segment: rareFind.segment,
      epoch: rareFind.epoch,
      tier: 5,
      seenAt: 2000,
    });
  });

  it("sends the artifact id only for a rare claimed pick-up and closes its lead", async () => {
    const pickup = award(
      id("d"),
      {
        kind: "find_picked_up",
        earner: "bond",
        tier: 5,
        subject: rareFind.artifactId,
        at: 3000,
      },
      rareFind,
    );
    pending = [pickup];
    const port = access(async (sent) => accepted(sent));

    await flushCommittedAwards("0x0sky", port);

    expect(vi.mocked(port.commitAwards).mock.calls[0]?.[0][0]).toMatchObject({
      id: pickup.id,
      tier: 5,
      artifactId: rareFind.artifactId,
    });
    expect(closeCommittedLead).toHaveBeenCalledWith(
      "0x0sky",
      rareFind.artifactId,
      "picked-up",
    );
    expect(keepCommittedAward).toHaveBeenCalledWith("0x0sky", pickup.id);
  });

  it("drops a taken claim, closes the lead, and emits the deterministic loss", async () => {
    const pickup = award(
      id("e"),
      {
        kind: "find_picked_up",
        earner: "bond",
        tier: 5,
        subject: rareFind.artifactId,
        at: 4000,
      },
      rareFind,
    );
    pending = [pickup];
    const port = access(async (sent) => answered(sent, { kind: "taken" }));
    const events: CommittedWorldEvent[] = [];

    await flushCommittedAwards("0x0sky", port, (event) => events.push(event));

    expect(keepCommittedAward).not.toHaveBeenCalled();
    expect(closeCommittedLead).toHaveBeenCalledWith(
      "0x0sky",
      rareFind.artifactId,
      "taken",
    );
    expect(dropCommittedAward).toHaveBeenCalledWith(
      "0x0sky",
      pickup.id,
      "taken",
    );
    expect(events).toEqual([
      {
        kind: "find-taken",
        tier: 5,
        artifactId: rareFind.artifactId,
      },
    ]);
  });

  it("closes an already-yours claim quietly and never keeps duplicate XP", async () => {
    const pickup = award(
      id("f"),
      {
        kind: "find_picked_up",
        earner: "bond",
        tier: 5,
        subject: rareFind.artifactId,
        at: 5000,
      },
      rareFind,
    );
    pending = [pickup];
    const port = access(async (sent) =>
      answered(sent, { kind: "already-yours" }),
    );
    const events: CommittedWorldEvent[] = [];

    await flushCommittedAwards("0x0sky", port, (event) => events.push(event));

    expect(keepCommittedAward).not.toHaveBeenCalled();
    expect(closeCommittedLead).toHaveBeenCalledWith(
      "0x0sky",
      rareFind.artifactId,
      "already-yours",
    );
    expect(events).toEqual([]);
  });

  it("retries the same commitment after an unanswered request", async () => {
    const seen = award(
      id("g"),
      {
        kind: "find_seen",
        earner: "avaia",
        subject: commonFind.artifactId,
        at: 6000,
      },
      commonFind,
    );
    pending = [seen];
    let offline = true;
    const port = access(async (sent) =>
      offline ? { kind: "service-unavailable" } : accepted(sent),
    );

    await flushCommittedAwards("0x0sky", port);
    expect(pending[0]?.id).toBe(seen.id);
    expect(keepCommittedAward).not.toHaveBeenCalled();

    offline = false;
    await flushCommittedAwards("0x0sky", port);

    expect(vi.mocked(port.commitAwards).mock.calls.map((call) => call[0][0]?.id))
      .toEqual([seen.id, seen.id]);
    expect(keepCommittedAward).toHaveBeenCalledWith("0x0sky", seen.id);
  });

  it("drops invalid and capped awards instead of inventing success", async () => {
    const invalid = award(
      id("h"),
      {
        kind: "zone_walked",
        earner: "bond",
        subject: "cell:invalid",
        at: 7000,
      },
    );
    pending = [invalid];
    const invalidPort = access(async () => ({
      kind: "rejected",
      reason: "invalid",
    }));

    await flushCommittedAwards("0x0sky", invalidPort);
    expect(dropCommittedAward).toHaveBeenCalledWith(
      "0x0sky",
      invalid.id,
      "invalid",
    );

    vi.clearAllMocks();
    vi.mocked(progressionSnapshot).mockReturnValue(READY_PROGRESSION);
    vi.mocked(readCommittedJournal).mockImplementation(async () => snapshot());
    vi.mocked(dropCommittedAward).mockImplementation(
      async (_owner, commitment) => {
        const first = pending[0];
        if (first === undefined || first.id !== commitment) return undefined;
        pending = pending.slice(1);
        return first;
      },
    );
    const capped = award(
      id("i"),
      {
        kind: "zone_walked",
        earner: "bond",
        subject: "cell:capped",
        at: 8000,
      },
    );
    pending = [capped];
    const cappedPort = access(async (sent) =>
      answered(sent, { kind: "capped" }),
    );

    await flushCommittedAwards("0x0sky", cappedPort);
    expect(dropCommittedAward).toHaveBeenCalledWith(
      "0x0sky",
      capped.id,
      "capped",
    );
  });

  it("rebases onto the head returned by a behind answer", async () => {
    const seen = award(
      id("j"),
      {
        kind: "find_seen",
        earner: "avaia",
        subject: commonFind.artifactId,
        at: 9000,
      },
      commonFind,
    );
    pending = [seen];
    const serverHead = id("s");
    const port = access(async (sent) =>
      answered(sent, { kind: "behind", head: serverHead }),
    );

    await flushCommittedAwards("0x0sky", port);

    expect(rebaseCommittedAwards).toHaveBeenCalledWith("0x0sky", serverHead);
    expect(keepCommittedAward).not.toHaveBeenCalled();
  });

  it("waits for legacy carry and pending events to migrate before R3 awards", async () => {
    const seen = award(
      id("k"),
      {
        kind: "find_seen",
        earner: "avaia",
        subject: commonFind.artifactId,
        at: 10_000,
      },
      commonFind,
    );
    pending = [seen];
    vi.mocked(progressionSnapshot).mockReturnValue({
      ...READY_PROGRESSION,
      carrySubmitted: false,
    });
    const port = access(async (sent) => accepted(sent));

    await flushCommittedAwards("0x0sky", port);

    expect(port.commitAwards).not.toHaveBeenCalled();
    expect(pending[0]?.id).toBe(seen.id);
  });
});
