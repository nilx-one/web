// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  artifactSha,
  bucketsFor,
  claimBucket,
  closedLeads,
  isArtifactSha,
  isClaimed,
  type ArtifactId,
  type FindLead,
  type Tier,
} from "./index";

const lead = (column: number, tier: Tier = 5): FindLead => {
  const segment = `seg:312346:${298_243 + column}` as const;
  return {
    artifactId: `art:${segment}:e2961:1:0`,
    segment,
    epoch: "e2961",
    tier,
    seenAt: 1_000 + column,
  };
};

describe("artifactSha", () => {
  it("is the SHA-256 of the domain and the artifactId, the same everywhere", async () => {
    // Golden: changing the domain or the id format changes every claim.
    expect(await artifactSha("art:seg:312346:298243:e2961:1:0")).toBe(
      "3366f9fe9be8b666ca9f8bd76b66db632526f4ec5b394e791ee1411d8053d3a6",
    );
  });

  it("names each find apart", async () => {
    const a = await artifactSha(lead(0).artifactId);
    const b = await artifactSha(lead(1).artifactId);
    const nextWeek = await artifactSha(
      "art:seg:312346:298243:e2962:1:0" as ArtifactId,
    );
    expect(new Set([a, b, nextWeek]).size).toBe(3);
    expect([a, b, nextWeek].every(isArtifactSha)).toBe(true);
  });
});

describe("isClaimed", () => {
  it("claims tiers 4 to 6 and leaves the commoner ones to every Bond", () => {
    expect(([1, 2, 3, 4, 5, 6] as const).map(isClaimed)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });
});

describe("isArtifactSha", () => {
  it("takes 64 lowercase hex digits and nothing else", () => {
    expect(isArtifactSha("a".repeat(64))).toBe(true);
    expect(isArtifactSha("A".repeat(64))).toBe(false);
    expect(isArtifactSha("a".repeat(63))).toBe(false);
    expect(isArtifactSha(42)).toBe(false);
  });
});

describe("closedLeads", () => {
  it("sorts leads by who got there, and keeps the rest open", async () => {
    const leads = [lead(0), lead(1), lead(2)];
    const claimed = new Map([
      [await artifactSha(lead(0).artifactId), "theirs" as const],
      [await artifactSha(lead(2).artifactId), "yours" as const],
      [await artifactSha(lead(9).artifactId), "theirs" as const],
    ]);
    expect(await closedLeads(leads, claimed)).toEqual({
      taken: [lead(0)],
      yours: [lead(2)],
    });
  });

  it("closes nothing when nothing is claimed", async () => {
    expect(await closedLeads([lead(0)], new Map())).toEqual({
      taken: [],
      yours: [],
    });
  });
});

describe("bucketsFor", () => {
  it("asks for the first byte of each lead's sha, each bucket once", async () => {
    const leads = [lead(0), lead(1), lead(0)];
    const shas = await Promise.all(
      leads.map((one) => artifactSha(one.artifactId)),
    );
    const buckets = await bucketsFor(leads);
    expect(buckets).toEqual([...new Set(shas.map(claimBucket))].sort());
    expect(claimBucket(shas[0]!)).toBe("33");
    expect(buckets.every((bucket) => /^[0-9a-f]{2}$/.test(bucket))).toBe(true);
  });
});
