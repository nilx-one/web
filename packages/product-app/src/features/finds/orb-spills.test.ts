// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  findPoint,
  orbCount,
  orbId,
  type FindRoll,
  type LonLat,
} from "@nilx-one/artifact-contract";
import { mapDistanceMeters } from "@nilx-one/map-contract";
import { describe, expect, it } from "vitest";

import {
  liveSpill,
  lyingOrbs,
  mapOrbs,
  MIN_TRAIL_METERS,
  orbsInReach,
  refreshSpill,
  trailStart,
} from "./orb-spills";

const roll: Pick<FindRoll, "artifactId" | "segment" | "placement"> = {
  artifactId: "art:seg:312346:298243:e2961:1:0",
  segment: "seg:312346:298243",
  placement: { along: 0.5, across: 0.2 },
};
const count = orbCount(roll.artifactId);
const to = findPoint(roll);
const center: LonLat = [to[0] - 0.001, to[1] - 0.0006];
const view = {
  sha: "ab".padEnd(64, "0"),
  count,
  expiresAt: 1_000_000 + 30 * 60_000,
  taken: [1],
};
const spill = liveSpill(view, roll, () => center, 1_000_000);

const meters = (a: LonLat, b: LonLat) =>
  mapDistanceMeters(
    { longitude: a[0], latitude: a[1] },
    { longitude: b[0], latitude: b[1] },
  );

describe("a spill on this device", () => {
  it("leads from the middle of the find's cell to the find", () => {
    expect(spill.from).toEqual(center);
    expect(spill.to).toEqual(to);
  });

  it("stretches a trail too short to follow", () => {
    const start = trailStart(to, to);
    expect(meters(start, to)).toBeCloseTo(MIN_TRAIL_METERS, 0);
  });

  it("lies until its time, without what someone already took", () => {
    const lying = lyingOrbs(spill, new Set(), 1_000_000);
    expect(lying).toHaveLength(count - 1);
    expect(lying.map((orb) => orb.id)).not.toContain(orbId(roll.artifactId, 1));
    expect(lyingOrbs(spill, new Set(), view.expiresAt)).toEqual([]);
    // Each orb lands a beat after the one before it.
    expect(lying[1]!.landsAt).toBeGreaterThan(lying[0]!.landsAt);
  });

  it("draws its orbs and the find they lead to", () => {
    const drawn = mapOrbs([spill], new Set(), 1_000_000);
    expect(drawn.filter((orb) => orb.kind === "orb")).toHaveLength(count - 1);
    expect(drawn.filter((orb) => orb.kind === "goal")).toEqual([
      expect.objectContaining({ longitude: to[0], latitude: to[1] }),
    ]);
    expect(mapOrbs([spill], new Set(), view.expiresAt)).toEqual([]);
  });

  it("is in reach only within fifteen metres, and not once picked up", () => {
    const [first] = lyingOrbs(spill, new Set(), 1_000_000);
    const at = { longitude: first!.point[0], latitude: first!.point[1] };
    const reach = orbsInReach([spill], new Set(), at, 1_000_000);
    expect(reach[0]).toBe(first!.id);
    expect(
      orbsInReach([spill], new Set([first!.id]), at, 1_000_000),
    ).not.toContain(first!.id);
    const far = { longitude: center[0] - 0.01, latitude: center[1] };
    expect(orbsInReach([spill], new Set(), far, 1_000_000)).toEqual([]);
  });

  it("takes a newer answer about what is taken without moving", () => {
    const fresher = refreshSpill(spill, { ...view, taken: [0, 1, 2] });
    expect(fresher.from).toEqual(spill.from);
    expect(fresher.appearedAt).toBe(spill.appearedAt);
    expect(lyingOrbs(fresher, new Set(), 1_000_000)).toHaveLength(count - 3);
  });
});
