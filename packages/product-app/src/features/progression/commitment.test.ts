// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  awardAmount,
  canonicalAward,
  commitAward,
  importHistoryKey,
  isCommitment,
  newHistoryKey,
  replayChain,
  type AwardRecord,
} from "./commitment";

const pickUp: AwardRecord = {
  kind: "find_picked_up",
  earner: "bond",
  tier: 5,
  subject: "art:seg:312346:298243:e2961:1:0",
  at: 1_000,
};
const walked: AwardRecord = {
  kind: "zone_walked",
  earner: "bond",
  subject: "cell:1:2",
  at: 2_000,
};

const fixedKey = () => importHistoryKey(new Uint8Array(32).fill(7));

describe("commitAward", () => {
  it("is the HMAC of the parent and the record, as any HMAC-SHA-256 computes it", async () => {
    // Golden, computed apart with Node's crypto: the server and other devices
    // must agree on the canonical form byte for byte.
    const key = await fixedKey();
    const first = await commitAward(key, null, pickUp);
    expect(first).toBe("xp:6q8hs6UNjD6OtgqeqPA0u9_uGegwGNP2YxmR5eAg2-w");
    expect(await commitAward(key, first, walked)).toBe(
      "xp:_vyq1fwz4w-bhZ3ybaHVCqpj0EqZIJIX-6tgWDclaV8",
    );
  });

  it("fits the event id the service already takes", async () => {
    const commitment = await commitAward(await newHistoryKey(), null, walked);
    expect(isCommitment(commitment)).toBe(true);
    expect(commitment).toMatch(/^xp:[A-Za-z0-9._-]{1,76}$/);
  });

  it("changes with the key, the parent and every field of the record", async () => {
    const key = await fixedKey();
    const base = await commitAward(key, null, pickUp);
    const variants = await Promise.all([
      commitAward(await newHistoryKey(), null, pickUp),
      commitAward(key, base, pickUp),
      commitAward(key, null, { ...pickUp, tier: 6 }),
      commitAward(key, null, { ...pickUp, subject: "art:other" }),
      commitAward(key, null, { ...pickUp, at: 1_001 }),
      commitAward(key, null, { ...pickUp, earner: "avaia", tier: 3 }),
    ]);
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
  });

  it("refuses a field that could be read two ways", () => {
    expect(() =>
      canonicalAward(null, { ...walked, subject: "cell:1\nfind_seen" }),
    ).toThrow(RangeError);
  });
});

describe("replayChain", () => {
  it("replays a history to the head the last commitment named", async () => {
    const key = await fixedKey();
    const head = await commitAward(
      key,
      await commitAward(key, null, pickUp),
      walked,
    );
    expect(await replayChain(key, [pickUp, walked])).toBe(head);
    expect(await replayChain(key, [])).toBeNull();
  });

  it("shows a history that was reordered, cut or edited", async () => {
    const key = await fixedKey();
    const head = await replayChain(key, [pickUp, walked]);
    expect(await replayChain(key, [walked, pickUp])).not.toBe(head);
    expect(await replayChain(key, [pickUp])).not.toBe(head);
    expect(await replayChain(key, [{ ...pickUp, tier: 6 }, walked])).not.toBe(
      head,
    );
  });
});

describe("awardAmount", () => {
  it("prices each kind for whoever may earn it", () => {
    expect(awardAmount({ kind: "zone_revealed", earner: "avaia" })).toBe(10);
    expect(awardAmount({ kind: "zone_walked", earner: "bond" })).toBe(30);
    expect(awardAmount({ kind: "landmark_studied", earner: "avaia" })).toBe(45);
    expect(awardAmount({ kind: "landmark_noticed", earner: "bond" })).toBe(20);
    expect(awardAmount({ kind: "find_seen", earner: "avaia" })).toBe(10);
    expect(awardAmount({ kind: "find_seen", earner: "bond" })).toBe(10);
    expect(
      awardAmount({ kind: "find_picked_up", earner: "bond", tier: 6 }),
    ).toBe(1000);
    expect(
      awardAmount({ kind: "find_picked_up", earner: "avaia", tier: 3 }),
    ).toBe(60);
  });

  it("pays nothing for an award that cannot be earned that way", () => {
    expect(awardAmount({ kind: "zone_revealed", earner: "bond" })).toBeNull();
    expect(awardAmount({ kind: "zone_walked", earner: "avaia" })).toBeNull();
    expect(
      awardAmount({ kind: "landmark_studied", earner: "bond" }),
    ).toBeNull();
    expect(
      awardAmount({ kind: "landmark_noticed", earner: "avaia" }),
    ).toBeNull();
    expect(
      awardAmount({ kind: "find_picked_up", earner: "avaia", tier: 4 }),
    ).toBeNull();
    expect(awardAmount({ kind: "find_picked_up", earner: "bond" })).toBeNull();
    expect(
      awardAmount({ kind: "zone_walked", earner: "bond", tier: 2 }),
    ).toBeNull();
  });
});
