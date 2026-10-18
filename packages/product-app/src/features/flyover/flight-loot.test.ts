// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import { flightPath, localFrame, pathAt } from "./flyover-flight";
import {
  crossedFlightLoot,
  laserLootTargets,
  LOOT_LASER_RANGE_METERS,
  LOOT_NEAR_METERS,
  LOOT_MIN_VISIBLE_METERS,
  rarerLoot,
  validFlightLoot,
  visibleFlightLoot,
  type FlightLootSpawn,
} from "./flight-loot";

const path = flightPath([[0, 0], [0, 1_000]]);
const frame = localFrame([30.5, 50.45]);
const spawn = (
  lane: FlightLootSpawn["lane"],
  distanceMeters = 160,
): FlightLootSpawn => ({
  id: `loot:${lane}`,
  lane,
  distanceMeters,
  heightMeters: 14,
  kind: "orb",
  rarity: "rare",
});

describe("xPing flight loot presentation", () => {
  it("reveals five seconds ahead; near glow only 30 metres from the item", () => {
    const empty = new Set<string>();
    const items = [spawn(-1)];
    expect(visibleFlightLoot(path, frame, items, 0, 30, empty)).toEqual([]);
    let seen = visibleFlightLoot(path, frame, items, 10, 30, empty);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.near).toBe(false);
    seen = visibleFlightLoot(path, frame, items, 130, 30, empty);
    expect(seen[0]?.near).toBe(true);
    expect(LOOT_MIN_VISIBLE_METERS).toBe(150);
    expect(LOOT_NEAR_METERS).toBe(30);
    expect(
      visibleFlightLoot(path, frame, items, 120, 75, empty)[0]?.near,
    ).toBe(false);
    expect(visibleFlightLoot(path, frame, items, 0, 75, empty)).toHaveLength(1);
  });

  it("keeps the same world position when the preview horizon changes", () => {
    const items = [spawn(2, 300)];
    const slow = visibleFlightLoot(path, frame, items, 200, 30, new Set())[0]!;
    const fast = visibleFlightLoot(path, frame, items, 200, 75, new Set())[0]!;
    expect(slow.lngLat).toEqual(fast.lngLat);
  });

  it("collects only by swept 3D contact, including frame jumps", () => {
    const item = spawn(1);
    const before: [number, number, number] = [14, 130, 14];
    const after: [number, number, number] = [14, 195, 14];
    expect(crossedFlightLoot(path, item, before, after)).toBe(true);
    expect(
      crossedFlightLoot(path, item, [0, 130, 14], [0, 195, 14]),
    ).toBe(false);
    expect(
      crossedFlightLoot(path, item, [14, 130, 35], [14, 195, 35]),
    ).toBe(false);
    expect(crossedFlightLoot(path, item, before, before)).toBe(false);
    expect(pathAt(path, item.distanceMeters).point[1]).toBe(160);
  });

  it("locks no more than two forward targets using 3D distance", () => {
    const items = [
      { ...spawn(-1, 140), id: "left" },
      { ...spawn(0, 145), id: "centre" },
      { ...spawn(1, 145), id: "right" },
      { ...spawn(0, 190), id: "far" },
    ];
    expect(LOOT_LASER_RANGE_METERS).toBe(45);
    expect(
      laserLootTargets(path, items, 130, [0, 130, 14], new Set()),
    ).toEqual(["centre", "left"]);
    expect(
      laserLootTargets(path, items, 130, [0, 130, 14], new Set(["centre"])),
    ).toEqual(["left", "right"]);
    expect(
      laserLootTargets(path, items, 130, [0, 130, 120], new Set()),
    ).toEqual([]);
    expect(
      laserLootTargets(path, items, 160, [0, 160, 14], new Set()),
    ).toEqual(["far"]);
  });

  it("never shows a collected item twice, or a stronger aura from a lesser rarity", () => {
    const items = [spawn(0)];
    expect(
      visibleFlightLoot(path, frame, items, 155, 30, new Set(["loot:0"])),
    ).toEqual([]);
    expect(rarerLoot("rare", "common")).toBe("rare");
    expect(rarerLoot("rare", "exclusive")).toBe("exclusive");
    expect(rarerLoot("exclusive", "special")).toBe("exclusive");
  });

  it("rejects duplicate and malformed route placements without rolling replacements", () => {
    const correct = spawn(0);
    expect(
      validFlightLoot(
        [correct, correct, spawn(-2, 1200), spawn(2, -1)],
        path.length,
      ),
    ).toEqual([correct]);
  });
});
