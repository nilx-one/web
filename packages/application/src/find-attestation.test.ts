// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  hasFindAttestation,
  parseAttestAnswer,
  parseCraftAnswer,
  parseSaleAnswer,
} from "./find-attestation";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("Identity's attested-finds answers", () => {
  it("reads an attestation strictly", () => {
    expect(
      parseAttestAnswer(true, {
        outcome: "attested",
        attestation_id: ID,
        item_id: "small_change",
        seeds_credited: "15",
      }),
    ).toEqual({
      kind: "attested",
      attestationId: ID,
      itemId: "small_change",
      seedsCredited: 15n,
    });
    expect(
      parseAttestAnswer(true, {
        outcome: "already_yours",
        attestation_id: ID,
        item_id: "bottle",
        seeds_credited: "0",
      }).kind,
    ).toBe("attested");
    for (const bad of [
      {
        outcome: "attested",
        attestation_id: "nope",
        item_id: "bottle",
        seeds_credited: "0",
      },
      {
        outcome: "attested",
        attestation_id: ID,
        item_id: "Bottle!",
        seeds_credited: "0",
      },
      {
        outcome: "attested",
        attestation_id: ID,
        item_id: "bottle",
        seeds_credited: 15,
      },
      {
        outcome: "maybe",
        attestation_id: ID,
        item_id: "bottle",
        seeds_credited: "0",
      },
    ]) {
      expect(parseAttestAnswer(true, bad)).toEqual({ kind: "unavailable" });
    }
    expect(parseAttestAnswer(false, { error: { code: "too_far" } })).toEqual({
      kind: "refused",
      reason: "too_far",
    });
    expect(
      parseAttestAnswer(false, { error: { code: "rate_limited" } }),
    ).toEqual({ kind: "unavailable" });
  });

  it("reads a sale and a craft payment strictly", () => {
    expect(
      parseSaleAnswer(true, { outcome: "already_sold", seeds_credited: "600" }),
    ).toEqual({ kind: "sold", seedsCredited: 600n });
    expect(parseSaleAnswer(false, { error: { code: "used_up" } })).toEqual({
      kind: "refused",
      reason: "used_up",
    });
    expect(parseSaleAnswer(true, { outcome: "sold" })).toEqual({
      kind: "unavailable",
    });
    expect(
      parseCraftAnswer(true, { outcome: "started", seeds_debited: "200" }),
    ).toEqual({ kind: "paid", seedsDebited: 200n });
    expect(
      parseCraftAnswer(false, { error: { code: "session_inactive" } }),
    ).toEqual({ kind: "refused", reason: "inactive" });
    expect(
      parseCraftAnswer(false, { error: { code: "not_enough_seeds" } }),
    ).toEqual({ kind: "refused", reason: "not_enough_seeds" });
    expect(parseCraftAnswer(false, undefined)).toEqual({ kind: "unavailable" });
  });

  it("recognises a port only by all three operations", () => {
    const noop = async () => undefined;
    expect(
      hasFindAttestation({ attestFind: noop, sellFind: noop, payCraft: noop }),
    ).toBe(true);
    expect(hasFindAttestation({ attestFind: noop, sellFind: noop })).toBe(
      false,
    );
  });
});
