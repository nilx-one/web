// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { insideRings, mapCompassBearing, mapDistanceMeters } from "./index";

const kyiv = { longitude: 30.5234, latitude: 50.4501 };

describe("ground geometry both sides of the contract share", () => {
  it("measures a degree of latitude as about 111 km", () => {
    expect(
      mapDistanceMeters(kyiv, { ...kyiv, latitude: kyiv.latitude + 1 }),
    ).toBeCloseTo(111_195, -2);
    expect(mapDistanceMeters(kyiv, kyiv)).toBe(0);
  });

  it("reads headings clockwise from north, as a compass does", () => {
    const step = 0.001;
    expect(
      mapCompassBearing(kyiv, { ...kyiv, latitude: kyiv.latitude + step }),
    ).toBeCloseTo(0, 3);
    expect(
      mapCompassBearing(kyiv, { ...kyiv, longitude: kyiv.longitude + step }),
    ).toBeCloseTo(90, 1);
    expect(
      mapCompassBearing(kyiv, { ...kyiv, latitude: kyiv.latitude - step }),
    ).toBeCloseTo(180, 3);
    expect(
      mapCompassBearing(kyiv, { ...kyiv, longitude: kyiv.longitude - step }),
    ).toBeCloseTo(270, 1);
  });

  it("is inside an area's outer ring and in none of its holes", () => {
    const square = (x: number, y: number, side: number) =>
      [
        [x, y],
        [x + side, y],
        [x + side, y + side],
        [x, y + side],
        [x, y],
      ] as [number, number][];
    const rings = [square(0, 0, 4), square(1, 1, 2)];
    expect(insideRings([0.5, 0.5], rings)).toBe(true);
    expect(insideRings([2, 2], rings)).toBe(false);
    expect(insideRings([5, 5], rings)).toBe(false);
  });
});
