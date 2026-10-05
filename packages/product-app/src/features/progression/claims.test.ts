// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  AwardOutcome,
  ClaimsReadResult,
  CommitAwardsResult,
  CommittedAwardAccessPort,
} from "@nilx-one/application";
import { artifactSha, type FindLead } from "@nilx-one/artifact-contract";
import { describe, expect, it, vi } from "vitest";

import { claimedLeads, resolvePickUp } from "./claims";

const ID = `xp:${"a".repeat(43)}`;

const committed = (outcome: AwardOutcome): CommitAwardsResult => ({
  kind: "committed",
  experience: { bondXp: 0, avaiaXp: 0 },
  results: [{ id: ID, outcome }],
});

const lead = (column: number): FindLead => {
  const segment = `seg:312346:${298_243 + column}` as const;
  return {
    artifactId: `art:${segment}:e2961:1:0`,
    segment,
    epoch: "e2961",
    tier: 5,
    seenAt: 1_000 + column,
  };
};

function port(
  readClaims: CommittedAwardAccessPort["readClaims"],
): CommittedAwardAccessPort {
  return { commitAwards: vi.fn(), readClaims: vi.fn(readClaims) };
}

describe("resolvePickUp", () => {
  it("ends every answer the same way, every time", () => {
    expect(resolvePickUp(committed({ kind: "accepted" }), ID)).toBe("keep");
    expect(resolvePickUp(committed({ kind: "duplicate" }), ID)).toBe("keep");
    expect(resolvePickUp(committed({ kind: "already-yours" }), ID)).toBe(
      "close-quietly",
    );
    expect(resolvePickUp(committed({ kind: "taken" }), ID)).toBe("oh-crap");
    expect(resolvePickUp(committed({ kind: "capped" }), ID)).toBe("drop");
    expect(resolvePickUp(committed({ kind: "behind", head: null }), ID)).toBe(
      "drop",
    );
    expect(resolvePickUp(committed({ kind: "too-many-chains" }), ID)).toBe(
      "drop",
    );
  });

  it("keeps a pick-up pending while there is no answer", () => {
    expect(resolvePickUp({ kind: "service-unavailable" }, ID)).toBe("wait");
    for (const reason of [
      "rate-limited",
      "inactive",
      "authentication-required",
    ] as const) {
      expect(resolvePickUp({ kind: "rejected", reason }, ID)).toBe("wait");
    }
    // An answer that is not about this award is no answer for it.
    expect(
      resolvePickUp(committed({ kind: "accepted" }), `xp:${"b".repeat(43)}`),
    ).toBe("wait");
  });

  it("drops an award the service cannot read", () => {
    expect(resolvePickUp({ kind: "rejected", reason: "invalid" }, ID)).toBe(
      "drop",
    );
  });
});

describe("claimedLeads", () => {
  it("asks by bucket and closes leads on this device", async () => {
    const leads = [lead(0), lead(1), lead(2)];
    const [taken, yours] = await Promise.all([
      artifactSha(leads[0]!.artifactId),
      artifactSha(leads[1]!.artifactId),
    ]);
    const access = port(() =>
      Promise.resolve({
        kind: "read",
        epoch: 2961,
        claims: [
          { sha: taken, yours: false },
          { sha: yours, yours: true },
        ],
      }),
    );

    await expect(claimedLeads(access, leads)).resolves.toEqual({
      taken: [leads[0]],
      yours: [leads[1]],
    });
    const asked = vi.mocked(access.readClaims).mock.calls[0]![0];
    // Only buckets: two hex digits each, never a whole sha.
    expect(asked.every((bucket) => /^[0-9a-f]{2}$/.test(bucket))).toBe(true);
  });

  it("closes nothing when the claims cannot be read", async () => {
    for (const answer of [
      { kind: "service-unavailable" },
      { kind: "rejected", reason: "rate-limited" },
    ] satisfies ClaimsReadResult[]) {
      await expect(
        claimedLeads(
          port(() => Promise.resolve(answer)),
          [lead(0)],
        ),
      ).resolves.toBeUndefined();
    }
  });

  it("asks nothing for no leads", async () => {
    const access = port(() => Promise.reject(new Error("not asked")));
    await expect(claimedLeads(access, [])).resolves.toEqual({
      taken: [],
      yours: [],
    });
    expect(access.readClaims).not.toHaveBeenCalled();
  });
});
