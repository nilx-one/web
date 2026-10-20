// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  featureFilter,
  type FilterSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";

import {
  carriesMotherlandCutout,
  MOTHERLAND_MONUMENT_LOCATION,
  MOTHERLAND_PEDESTAL_RADIUS_METERS,
  motherlandPedestalRing,
  withoutMotherland,
} from "./monument-site";

const STYLE_FILTER: FilterSpecification = [
  "in",
  ["get", "kind"],
  ["literal", ["building", "building_part"]],
];

// The archive's last zoom, and MapLibre's tile extent.
const ZOOM = 15;
const EXTENT = 8192;
const METRES_PER_DEGREE = 111_195;

function tileOf(lng: number, lat: number) {
  const n = 2 ** ZOOM;
  const x = ((lng + 180) / 360) * n;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
  return { x, y };
}

const canonical = (() => {
  const { x, y } = tileOf(
    MOTHERLAND_MONUMENT_LOCATION.lng,
    MOTHERLAND_MONUMENT_LOCATION.lat,
  );
  return { z: ZOOM, x: Math.floor(x), y: Math.floor(y) };
})();

/** A square building part `side` metres across, `east`/`north` metres off the statue. */
function part(
  east: number,
  north: number,
  side: number,
  properties: Record<string, unknown>,
) {
  const { lng, lat } = MOTHERLAND_MONUMENT_LOCATION;
  const dLat = 1 / METRES_PER_DEGREE;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([sx, sy]) => {
    const t = tileOf(
      lng + (east + (sx! * side) / 2) * dLng,
      lat + (north + (sy! * side) / 2) * dLat,
    );
    return {
      x: Math.round((t.x - canonical.x) * EXTENT),
      y: Math.round((t.y - canonical.y) * EXTENT),
    };
  });
  return {
    type: 3 as const,
    properties: { kind: "building_part", ...properties },
    geometry: [corners],
  };
}

function drawn(feature: ReturnType<typeof part>): boolean {
  const filter = featureFilter(
    withoutMotherland(STYLE_FILTER),
    "layers[0].filter",
  );
  return filter.filter({ zoom: ZOOM }, feature as never, canonical as never);
}

describe("the Motherland cut-out", () => {
  it("cuts the basemap's drum and figure out of the extrusion", () => {
    // The drum, standing on the statue's axis.
    expect(drawn(part(0, 0, 28, { height: 26.5 }))).toBe(false);
    // The figure, and a floating sword part off to one side.
    expect(drawn(part(0, 0, 8, { height: 74.25 }))).toBe(false);
    expect(drawn(part(8, -9, 1, { height: 89, min_height: 84 }))).toBe(false);
  });

  it("keeps the terraces around the drum that a body walks on", () => {
    // The 13 m terrace the drum stands on, and a wedge of its outer ring.
    expect(drawn(part(0, 0, 60, { height: 13 }))).toBe(true);
    expect(drawn(part(35, 0, 10, { height: 13 }))).toBe(true);
    // The whole complex outline, which the data gives no height at all.
    expect(drawn(part(0, 0, 140, {}))).toBe(true);
  });

  it("keeps a tall building that only stands near the statue", () => {
    expect(drawn(part(45, 0, 20, { height: 40 }))).toBe(true);
  });

  it("folds into the style's filter once, however often it is applied", () => {
    const once = withoutMotherland(STYLE_FILTER);
    expect(carriesMotherlandCutout(STYLE_FILTER)).toBe(false);
    expect(carriesMotherlandCutout(once)).toBe(true);
    expect(withoutMotherland(once)).toBe(once);
    expect(once).toEqual(["all", STYLE_FILTER, expect.anything()]);
  });

  it("stands alone where the style gives the layer no filter", () => {
    expect(withoutMotherland(undefined)).toEqual(["!", expect.anything()]);
    expect(withoutMotherland(null)).toEqual(["!", expect.anything()]);
  });
});

describe("the Motherland plinth", () => {
  it("rings the statue at the plinth's radius, closed", () => {
    const ring = motherlandPedestalRing();
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const { lng, lat } = MOTHERLAND_MONUMENT_LOCATION;
    for (const [longitude, latitude] of ring) {
      const east =
        (longitude - lng) * METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
      const north = (latitude - lat) * METRES_PER_DEGREE;
      expect(Math.hypot(east, north)).toBeCloseTo(
        MOTHERLAND_PEDESTAL_RADIUS_METERS,
        3,
      );
    }
  });
});
