// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { RoadFeature } from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";

import { flyoverRoadBounds, planFlyoverRoute } from "./flyover-route";

const DOROHOZHYCHI = [30.4467, 50.4734] as const;
const ZOLOTI_VOROTA = [30.5131, 50.4489] as const;

describe("planFlyoverRoute", () => {
  it("follows the road graph from end to end", () => {
    // An L of streets: east along the north side, then south.
    const roads: RoadFeature[] = [
      {
        kind: "path",
        lines: [
          [
            [30.4468, 50.4734],
            [30.513, 50.4734],
            [30.513, 50.449],
          ],
        ],
      },
    ];
    const route = planFlyoverRoute(DOROHOZHYCHI, ZOLOTI_VOROTA, roads);
    expect(route[0]).toEqual(DOROHOZHYCHI);
    expect(route[route.length - 1]).toEqual(ZOLOTI_VOROTA);
    expect(route).toContainEqual([30.513, 50.4734]);
  });

  it("is the straight line without a path on the graph", () => {
    expect(planFlyoverRoute(DOROHOZHYCHI, ZOLOTI_VOROTA, [])).toEqual([
      DOROHOZHYCHI,
      ZOLOTI_VOROTA,
    ]);
  });

  it("reads roads in a box around both ends", () => {
    const bounds = flyoverRoadBounds(DOROHOZHYCHI, ZOLOTI_VOROTA);
    expect(bounds.west).toBeLessThan(DOROHOZHYCHI[0]);
    expect(bounds.east).toBeGreaterThan(ZOLOTI_VOROTA[0]);
    expect(bounds.south).toBeLessThan(ZOLOTI_VOROTA[1]);
    expect(bounds.north).toBeGreaterThan(DOROHOZHYCHI[1]);
  });
});
