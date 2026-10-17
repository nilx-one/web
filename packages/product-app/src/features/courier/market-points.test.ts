// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0
import { expect, it } from "vitest";
import {
  KYIV_MARKET_POINTS,
  marketMapPoints,
  seededMarketDirectory,
  seededMarketPlan,
  marketPointId,
} from "./market-points";
import { courierCoordinate } from "./courier-map";

it("uses the same 22 distinct Kyiv destinations for pins and courier dispatch", async () => {
  const pins = marketMapPoints("uk-UA", "xPing");
  const projection = await seededMarketDirectory.destinations();
  expect(pins).toHaveLength(22);
  expect(new Set(projection.destinations.map((p) => p.point_id)).size).toBe(22);
  expect(pins.map((p) => p.id)).toEqual(
    projection.destinations.map((p) => `market:${p.point_id}`),
  );
  for (const point of KYIV_MARKET_POINTS) {
    expect(point.longitude).toBeGreaterThan(30.2);
    expect(point.longitude).toBeLessThan(30.9);
    expect(point.latitude).toBeGreaterThan(50.3);
    expect(point.latitude).toBeLessThan(50.6);
    const plan = seededMarketPlan({
      ...projection,
      origin: courierCoordinate(point),
      tier: "exclusive",
      started_at_ms: "1000",
    });
    expect(plan.destination.point_id).toBe(marketPointId(point));
    expect(plan.distance_m).toBe("0");
  }
  expect(pins.find((p) => p.id.endsWith("zoloti-vorota"))?.title).toBe(
    "0xda-market Золоті Ворота",
  );
  expect(pins.find((p) => p.id.endsWith("tsum"))?.title).toContain("🤍");
  expect(pins.find((p) => p.id.endsWith("gulliver"))?.title).toContain("🖤");
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
