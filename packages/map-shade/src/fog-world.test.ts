// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";

import { beyondAtlas, worldFog } from "./fog-world";

const bounds = { west: 30, east: 31, south: 50, north: 51 };
const inside = latLngToCell(50.5, 30.5, 9);
const far = latLngToCell(48.5, 35, 9);

function area(ring: [number, number][]): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    total += (ring[j]![0] - ring[i]![0]) * (ring[j]![1] + ring[i]![1]);
  return total;
}

describe("world fog", () => {
  it("tells ground the atlas covers from ground beyond it", () => {
    expect(beyondAtlas(inside, bounds)).toBe(false);
    expect(beyondAtlas(far, bounds)).toBe(true);
  });

  it("covers the Earth around a slightly smaller atlas hole", () => {
    const [earth, ...rest] = worldFog(bounds, []).geometry.coordinates;
    const [outer, hole] = earth!;
    expect(rest).toEqual([]);
    expect(outer).toContainEqual([-180, -85.051129]);
    // The hole sits just inside the atlas, so the two surfaces overlap.
    const lngs = hole!.map((point) => point[0]);
    expect(Math.min(...lngs)).toBeGreaterThan(bounds.west);
    expect(Math.max(...lngs)).toBeLessThan(bounds.east);
    // Outer ring and holes wind opposite ways, as MapLibre needs.
    expect(Math.sign(area(outer!))).toBe(-Math.sign(area(hole!)));
  });

  it("opens revealed ground beyond the atlas and keeps enclosed fog", () => {
    const ring = gridDisk(far, 2).filter((cell) => cell !== far);
    const [earth, ...islands] = worldFog(bounds, ring).geometry.coordinates;
    const [outer, ...holes] = earth!;
    // The atlas square, then one merged hole for the revealed ring.
    expect(holes).toHaveLength(2);
    expect(Math.sign(area(holes[1]!))).toBe(-Math.sign(area(outer!)));
    // The unrevealed centre stays fog, as its own polygon.
    expect(islands).toHaveLength(1);
    expect(Math.sign(area(islands[0]![0]!))).toBe(Math.sign(area(outer!)));
  });
});
