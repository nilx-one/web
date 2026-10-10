// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  findPoint,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import { describe, expect, it } from "vitest";

import {
  fromCoordinate,
  knownSpill,
  mapOrbs,
  orbWorldInput,
  refreshSpill,
  toCoordinate,
} from "./orb-spills";

const roll: Pick<FindRoll, "artifactId" | "segment" | "placement"> = {
  artifactId: "art:seg:312346:298243:e2961:1:0",
  segment: "seg:312346:298243",
  placement: { along: 0.5, across: 0.2 },
};
const center: LonLat = [30.4461, 50.465];
const view = {
  sha: "ab".padEnd(64, "0"),
  count: 12,
  expiresAt: 1_801_000,
  taken: [1],
};

describe("orbs between the map and Core", () => {
  it("keeps the service's answer, leading from the find's cell to the find", () => {
    const spill = knownSpill(view, roll, () => center, 1_000);
    expect(spill).toMatchObject({
      artifactId: roll.artifactId,
      count: 12,
      taken: [1],
      from: center,
      to: findPoint(roll),
      appearedAt: 1_000,
    });
    const fresher = refreshSpill(spill, { ...view, taken: [0, 1] });
    expect(fresher.taken).toEqual([0, 1]);
    expect(fresher.from).toEqual(spill.from);
  });

  it("asks Core in its own wire: E7 decimals and decimal times", () => {
    const spill = knownSpill(view, roll, () => center, 1_000);
    const input = orbWorldInput([spill], new Set(["orb:x"]), undefined, {
      longitude: 30.4469,
      latitude: 50.4655,
    });
    expect(input).toEqual({
      spills: [
        {
          artifact_id: roll.artifactId,
          from: { longitude_e7: "304461000", latitude_e7: "504650000" },
          to: toCoordinate(findPoint(roll)),
          appeared_at: "1000",
          expires_at: "1801000",
          count: 12,
          taken: [1],
        },
      ],
      picked: ["orb:x"],
      bond: null,
      avaia: { longitude_e7: "304469000", latitude_e7: "504655000" },
    });
    expect(fromCoordinate(toCoordinate([-0.0000001, 0]))).toEqual([-1e-7, 0]);
    expect(toCoordinate([0, -0.00000001])).toEqual({
      longitude_e7: "0",
      latitude_e7: "0",
    });
  });

  it("draws exactly what Core laid out", () => {
    expect(
      mapOrbs({
        orbs: [
          {
            id: "orb:a:0",
            kind: "orb",
            at: { longitude_e7: "304469000", latitude_e7: "504655000" },
            lands_at: "1070",
          },
        ],
        bond_reach: [],
        avaia_reach: [],
        next_expiry: null,
      }),
    ).toEqual([
      {
        id: "orb:a:0",
        kind: "orb",
        longitude: 30.4469,
        latitude: 50.4655,
        landsAt: 1070,
      },
    ]);
  });
});
