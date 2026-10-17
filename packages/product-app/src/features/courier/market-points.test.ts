// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { expect, it } from "vitest";
import { courierDestinationRequest } from "@nilx-one/application";
import {
  KYIV_MARKET_BUSINESS_POINTS,
  KYIV_MARKET_POINTS,
  LEGACY_MARKET_POINT_NUMBERS,
  marketMapPoints,
  marketPinId,
  seededMarketDestination,
  seededMarketDirectory,
} from "./market-points";
import { courierCoordinate } from "./courier-map";

it("uses the same 22 unverified BusinessPoints for pins and courier dispatch", async () => {
  const pins = marketMapPoints("uk-UA", "xPing");
  const projection = await seededMarketDirectory.points();
  expect(pins).toHaveLength(22);
  expect(projection.points).toBe(KYIV_MARKET_BUSINESS_POINTS);
  expect(new Set(projection.points.map((p) => p.id.number)).size).toBe(22);
  expect(pins.map((p) => p.id)).toEqual(projection.points.map(marketPinId));
  // Valid for Core's selector: one owner, UInt8 numbers, unique ids.
  expect(
    courierDestinationRequest(projection.points[0]!.coordinate, projection)
      .candidates,
  ).toHaveLength(22);
  for (const point of projection.points) {
    expect(point.isVerified).toBe(false);
    expect(point.id.owner_pub_dress).toBe("0xda-market");
    expect(point.id.number).toBeGreaterThanOrEqual(0);
    expect(point.id.number).toBeLessThanOrEqual(255);
    expect(LEGACY_MARKET_POINT_NUMBERS.get(point.pub_dress)).toBe(
      point.id.number,
    );
  }
  for (const point of KYIV_MARKET_POINTS) {
    expect(point.longitude).toBeGreaterThan(30.2);
    expect(point.longitude).toBeLessThan(30.9);
    expect(point.latitude).toBeGreaterThan(50.3);
    expect(point.latitude).toBeLessThan(50.6);
    expect(seededMarketDestination(courierCoordinate(point)).id.number).toBe(
      point.number,
    );
  }
  expect(
    seededMarketDirectory.previewDestination!(
      courierCoordinate(KYIV_MARKET_POINTS[0]!),
      projection,
    ).pub_dress,
  ).toBe("0xda-market-zoloti-vorota");
  expect(() =>
    seededMarketDirectory.previewDestination!(
      courierCoordinate(KYIV_MARKET_POINTS[0]!),
      { ...projection },
    ),
  ).toThrow();
  const pin = (place: string) =>
    pins[KYIV_MARKET_POINTS.findIndex((p) => p.id === place)];
  expect(pin("zoloti-vorota")?.title).toBe("0xda-market Золоті Ворота");
  expect(pin("tsum")?.title).toContain("🤍");
  expect(pin("gulliver")?.title).toContain("🖤");
});

it("keeps the two DREAM malls and two Troieshchyna destinations separate", () => {
  const pins = marketMapPoints("en", "xPing");
  expect(
    pins.find((p) => p.title.endsWith("DREAM berry"))?.latitude,
  ).toBeGreaterThan(
    pins.find((p) => p.title.endsWith("DREAM yellow"))!.latitude,
  );
  expect(pins.filter((p) => p.title.includes("Troieshchyna"))).toHaveLength(2);
});
