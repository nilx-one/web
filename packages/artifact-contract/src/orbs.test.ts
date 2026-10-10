// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  findPoint,
  isOrbId,
  ORB_MAX,
  ORB_MIN,
  orbCount,
  orbId,
  orbTrail,
  parseOrbId,
  segmentAt,
  type ArtifactId,
  type LonLat,
} from "./index";

const KYIV: ArtifactId = "art:seg:312346:298243:e2908:1:0";

function meters([aLng, aLat]: LonLat, [bLng, bLat]: LonLat): number {
  const y = (bLat - aLat) * 111_195;
  const x = (bLng - aLng) * 111_195 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(x, y);
}

describe("orbCount", () => {
  it("spills five to thirty orbs, the same for the same find", () => {
    const counts = new Set<number>();
    for (let row = 0; row < 400; row++) {
      const id: ArtifactId = `art:seg:${312000 + row}:298243:e2908:1:0`;
      const count = orbCount(id);
      expect(count).toBe(orbCount(id));
      expect(count).toBeGreaterThanOrEqual(ORB_MIN);
      expect(count).toBeLessThanOrEqual(ORB_MAX);
      counts.add(count);
    }
    expect(Math.min(...counts)).toBe(ORB_MIN);
    expect(Math.max(...counts)).toBe(ORB_MAX);
  });

  // The service counts with the same generator; `finds.rs` holds these too.
  it("matches the golden counts", () => {
    expect(
      [0, 1, 2, 3, 4].map((row) =>
        orbCount(`art:seg:${312346 + row}:298243:e2908:1:0`),
      ),
    ).toMatchInlineSnapshot(`
      [
        24,
        12,
        27,
        5,
        29,
      ]
    `);
  });
});

describe("orb ids", () => {
  it("name a find and one of its orbs, and nothing past the count", () => {
    const id = orbId(KYIV, 2);
    expect(id).toBe(`orb:${KYIV}:2`);
    expect(parseOrbId(id)).toEqual({ artifactId: KYIV, index: 2 });
    expect(isOrbId(id)).toBe(true);
    expect(parseOrbId(orbId(KYIV, orbCount(KYIV)))).toBeUndefined();
    expect(parseOrbId(`orb:${KYIV}:02`)).toBeUndefined();
    expect(isOrbId("orb:art:nope:1")).toBe(false);
  });
});

describe("orbTrail", () => {
  const to = findPoint({
    segment: "seg:312346:298243",
    placement: { along: 0.4, across: 0.2 },
  });
  const from: LonLat = [to[0] - 0.0008, to[1] - 0.0005];

  it("lays every orb once, numbered from the start of the trail", () => {
    const trail = orbTrail(KYIV, from, to);
    expect(trail).toHaveLength(orbCount(KYIV));
    expect(trail.map((spot) => spot.index)).toEqual(
      trail.map((_, index) => index),
    );
    expect(orbTrail(KYIV, from, to)).toEqual(trail);
  });

  it("falls in clumps of three to six that lead towards the find", () => {
    const trail = orbTrail(KYIV, from, to);
    const clumps = new Map<number, LonLat[]>();
    for (const spot of trail) {
      clumps.set(spot.clump, [...(clumps.get(spot.clump) ?? []), spot.point]);
    }
    const sizes = [...clumps.values()].map((points) => points.length);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(3);
      expect(size).toBeLessThanOrEqual(6);
    }
    const toFind = [...clumps.values()].map((points) =>
      Math.min(...points.map((point) => meters(point, to))),
    );
    // Each clump is nearer the find than the one before.
    for (let i = 1; i < toFind.length; i++) {
      expect(toFind[i]).toBeLessThan(toFind[i - 1]! + 6);
    }
    expect(toFind[toFind.length - 1]).toBeLessThan(meters(from, to) * 0.2);
  });
});

describe("findPoint", () => {
  it("lies inside the find's own segment", () => {
    for (const along of [0, 0.3, 0.99]) {
      for (const across of [-1, 0, 0.98]) {
        const point = findPoint({
          segment: "seg:312346:298243",
          placement: { along, across },
        });
        expect(segmentAt(point)).toBe("seg:312346:298243");
      }
    }
  });
});
