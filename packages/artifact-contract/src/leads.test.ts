// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  awardsFor,
  closeLead,
  leadsIn,
  liveLeads,
  MAX_LEADS,
  noteLead,
  parseLeads,
  ROLL_TABLE,
  type FindEvent,
  type FindLead,
  type FindRoll,
  type Tier,
} from "./index";

function find(tier: Tier, column = 0, epoch = "e2961" as const): FindRoll {
  const segment = `seg:312346:${298_243 + column}` as const;
  return {
    artifactId: `art:${segment}:${epoch}:1:0`,
    segment,
    epoch,
    packVersion: 1,
    slot: 0,
    tier,
    experience: ROLL_TABLE.tiers[tier - 1]!.experience,
    placement: { along: 0.5, across: 0 },
  };
}

describe("noteLead", () => {
  it("keeps a rare find the Avaia saw, with only what a lead needs", () => {
    const leads = noteLead([], find(5), 1_000);
    expect(leads).toEqual([
      {
        artifactId: find(5).artifactId,
        segment: find(5).segment,
        epoch: "e2961",
        tier: 5,
        seenAt: 1_000,
      },
    ]);
    expect(Object.keys(leads[0]!).sort()).toEqual([
      "artifactId",
      "epoch",
      "seenAt",
      "segment",
      "tier",
    ]);
  });

  it("never makes a lead of a find the Avaia picks up itself", () => {
    for (const tier of [1, 2, 3] as const) {
      expect(noteLead([], find(tier), 1_000)).toEqual([]);
    }
  });

  it("keeps the first sighting when the Avaia walks past again", () => {
    const once = noteLead([], find(4), 1_000);
    const again = noteLead(once, find(4), 9_000);
    expect(again).toEqual(once);
  });

  it("keeps at most twelve, dropping the oldest sighting", () => {
    let leads: FindLead[] = [];
    for (let column = 0; column < MAX_LEADS + 3; column++) {
      leads = noteLead(leads, find(6, column), 1_000 + column);
    }
    expect(leads).toHaveLength(MAX_LEADS);
    expect(leads.map((lead) => lead.seenAt)).toEqual(
      Array.from({ length: MAX_LEADS }, (_, i) => 1_003 + i),
    );
  });
});

describe("a lead's life", () => {
  it("lives until its week ends", () => {
    const leads = noteLead([], find(5, 0, "e2961"), 1_000);
    expect(liveLeads(leads, "e2961")).toHaveLength(1);
    expect(liveLeads(leads, "e2962")).toEqual([]);
  });

  it("is found again when a walk comes back to its segment that week", () => {
    const leads = noteLead(noteLead([], find(5, 0), 1), find(4, 1), 2);
    expect(leadsIn(leads, find(5, 0).segment, "e2961")).toEqual([leads[0]]);
    expect(leadsIn(leads, find(5, 0).segment, "e2962")).toEqual([]);
    expect(leadsIn(leads, find(5, 7).segment, "e2961")).toEqual([]);
  });

  it("closes when the person picks the find up, and pays the Bond once", () => {
    const roll = find(6);
    const journal: FindEvent[] = [
      { artifactId: roll.artifactId, kind: "seen", by: "avaia" },
    ];
    const leads = noteLead([], roll, 1_000);
    const paid = awardsFor(roll, { kind: "picked_up", by: "bond" }, journal);
    expect(paid).toEqual([
      {
        artifactId: roll.artifactId,
        kind: "picked_up",
        earner: "bond",
        experience: 1000,
      },
    ]);
    expect(closeLead(leads, roll.artifactId)).toEqual([]);
    // Closing what is not there is nothing.
    expect(closeLead(leads, find(6, 3).artifactId)).toEqual(leads);
  });
});

describe("parseLeads", () => {
  const good = noteLead([], find(5), 1_000)[0]!;

  it("reads back what was stored", () => {
    expect(parseLeads(JSON.parse(JSON.stringify([good])))).toEqual([good]);
  });

  it("drops anything malformed rather than trusting it", () => {
    const bad = [
      null,
      "lead",
      { ...good, tier: 7 },
      { ...good, tier: 4.5 },
      { ...good, seenAt: "yesterday" },
      { ...good, epoch: "week" },
      { ...good, segment: "seg:1:2", artifactId: good.artifactId },
      { ...good, artifactId: "art:somewhere" },
      { ...good, lat: 50.45, lon: 30.52, artifactId: "x" },
    ];
    expect(parseLeads(bad)).toEqual([]);
    expect(parseLeads({ leads: [good] })).toEqual([]);
  });

  it("keeps the first of duplicates and the cap", () => {
    expect(parseLeads([good, { ...good, seenAt: 5 }])).toEqual([good]);
    const many = Array.from(
      { length: MAX_LEADS + 4 },
      (_, column) => noteLead([], find(6, column), column)[0]!,
    );
    expect(parseLeads(many)).toHaveLength(MAX_LEADS);
  });
});
