// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  buildWalkGraph,
  distanceM,
  reachFrom,
  routeOnGraph,
  snapToGraph,
  surfaceOf,
  type LonLat,
  type RoadFeature,
  type WalkGraph,
} from "./index";

/**
 * Hand-built tile fragments around a fixed origin in Kyiv. `at(x, y)` is x metres
 * east and y metres north of it, so the expected lengths read off the fixture.
 */
const ORIGIN: LonLat = [30.52, 50.45];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];

const road = (
  kind: string,
  kindDetail: string | undefined,
  ...lines: LonLat[][]
): RoadFeature => ({ kind, kindDetail, lines });

const nodeAt = (graph: WalkGraph, point: LonLat) => {
  const index = graph.nodes.findIndex((node) => distanceM(node, point) < 0.05);
  if (index < 0) throw new Error(`no node at ${point.join(",")}`);
  return index;
};

const position = (graph: WalkGraph, point: LonLat) => {
  const snapped = snapToGraph(graph, point);
  if (snapped === null) throw new Error(`nothing to snap to`);
  return snapped;
};

const route = (graph: WalkGraph, from: LonLat, to: LonLat) =>
  routeOnGraph(graph, position(graph, from), position(graph, to));

describe("surfaceOf", () => {
  it.each([
    ["path", "footway", "footway"],
    ["path", "pedestrian", "footway"],
    ["path", "steps", "steps"],
    ["path", "track", "track"],
    ["minor_road", "track", "track"],
    ["minor_road", "residential", "street"],
    ["minor_road", "service", "street"],
    ["medium_road", undefined, "street"],
    ["major_road", "primary", "carriageway"],
    ["major_road", "trunk", null],
    ["highway", "motorway", null],
    ["highway", "primary", null],
    ["rail", "rail", null],
    ["ferry", undefined, null],
    ["path", "something_new", "footway"],
    ["unknown_kind", "footway", null],
  ] as const)("%s / %s is %s", (kind, detail, expected) => {
    expect(surfaceOf(kind, detail)).toBe(expected);
  });
});

describe("buildWalkGraph", () => {
  it("turns lines into nodes and measured edges", () => {
    const graph = buildWalkGraph([
      road("path", "footway", [at(0, 0), at(100, 0), at(100, 50)]),
    ]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.map((edge) => Math.round(edge.lengthM))).toEqual(
      expect.arrayContaining([100, 50]),
    );
    expect(graph.edges.every((edge) => edge.surface === "footway")).toBe(true);
    expect(graph.edges.every((edge) => edge.a < edge.b)).toBe(true);
  });

  it("joins lines at shared vertices", () => {
    const graph = buildWalkGraph([
      road("minor_road", "residential", [at(-50, 0), at(0, 0), at(50, 0)]),
      road("path", "footway", [at(0, -50), at(0, 0), at(0, 50)]),
    ]);
    const centre = nodeAt(graph, at(0, 0));
    expect(graph.adjacency[centre]).toHaveLength(4);
  });

  it("leaves out highways and rail but keeps the footway that crosses them", () => {
    const graph = buildWalkGraph([
      road("highway", "motorway", [at(-100, 0), at(0, 0), at(100, 0)]),
      road("rail", "rail", [at(-100, 10), at(100, 10)]),
      road("path", "footway", [at(0, -40), at(0, 0), at(0, 40)]),
    ]);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges.map((edge) => edge.surface)).toEqual([
      "footway",
      "footway",
    ]);
  });

  it("keeps the cheapest surface where two features draw the same stretch", () => {
    const graph = buildWalkGraph([
      road("minor_road", "residential", [at(0, 0), at(80, 0)]),
      road("path", "pedestrian", [at(80, 0), at(0, 0)]),
    ]);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.surface).toBe("footway");
  });

  it("does not depend on feature order or line direction", () => {
    const features = [
      road("minor_road", "residential", [at(0, 0), at(200, 0)]),
      road("path", "footway", [at(0, 0), at(0, 40), at(200, 40), at(200, 0)]),
      road("path", "steps", [at(100, 0), at(100, 40)]),
    ];
    const reversed = [...features].reverse().map((feature) => ({
      ...feature,
      lines: feature.lines.map((line) => [...line].reverse()),
    }));
    expect(buildWalkGraph(reversed)).toEqual(buildWalkGraph(features));
  });

  describe("tile boundaries", () => {
    // One straight footway, 0–200 m, cut by a tile edge at x = 100 with a 10 m
    // buffer: each tile clips it 10 m into its neighbour.
    const tileA = road("path", "footway", [at(0, 0), at(60, 0), at(110, 0)]);
    const tileB = road("path", "footway", [at(90, 0), at(150, 0), at(200, 0)]);

    it("joins a line clipped by two tiles back into one", () => {
      const graph = buildWalkGraph([tileA, tileB]);
      const walk = route(graph, at(0, 0), at(200, 0));
      expect(walk).not.toBeNull();
      expect(walk!.lengthM).toBeCloseTo(200, 0);
      expect(graph.edges).toHaveLength(5);
      const total = graph.edges.reduce((sum, edge) => sum + edge.lengthM, 0);
      expect(total).toBeCloseTo(200, 0);
    });

    it("joins a clip point that is off the line by a tile unit", () => {
      const graph = buildWalkGraph([
        road("path", "footway", [at(0, 0), at(60, 0), at(110, 0.3)]),
        road("path", "footway", [at(90, -0.3), at(150, 0), at(200, 0)]),
      ]);
      expect(route(graph, at(0, 0), at(200, 0))).not.toBeNull();
    });

    it("does not join a real dead end to a road a few metres away", () => {
      const graph = buildWalkGraph([
        road("path", "footway", [at(0, 0), at(100, 0)]),
        road("path", "footway", [at(50, 5), at(50, 60)]),
      ]);
      const along = position(graph, at(0, 0));
      const side = position(graph, at(50, 60));
      expect(routeOnGraph(graph, along, side)).toBeNull();
    });
  });
});

describe("snapToGraph", () => {
  const graph = buildWalkGraph([
    road("path", "footway", [at(0, 0), at(200, 0)]),
  ]);

  it("lands on the nearest point of an edge, not only on nodes", () => {
    const snapped = snapToGraph(graph, at(100, 12));
    expect(snapped?.t).toBeCloseTo(0.5, 2);
    expect(snapped?.distanceM).toBeCloseTo(12, 0);
  });

  it("finds nothing beyond 30 m", () => {
    expect(snapToGraph(graph, at(100, 31))).toBeNull();
    expect(
      snapToGraph(graph, at(100, 31), { maxDistanceM: 40 }),
    ).not.toBeNull();
  });

  it("skips ground the caller rules out", () => {
    expect(
      snapToGraph(graph, at(100, 5), { canEnter: () => false }),
    ).toBeNull();
  });
});

describe("routeOnGraph", () => {
  // A street along the bottom and a park footway looping above it.
  const block = (loopHeight: number) =>
    buildWalkGraph([
      road("minor_road", "residential", [at(0, 0), at(200, 0)]),
      road("path", "footway", [
        at(0, 0),
        at(0, loopHeight),
        at(200, loopHeight),
        at(200, 0),
      ]),
    ]);

  it("takes the footway when it costs less than the street", () => {
    const walk = route(block(40), at(0, 0), at(200, 0));
    expect(walk?.lengthM).toBeCloseTo(280, 0);
    expect(walk?.cost).toBeCloseTo(280, 0);
  });

  it("takes the street when the footway is too long a way round", () => {
    const walk = route(block(80), at(0, 0), at(200, 0));
    expect(walk?.lengthM).toBeCloseTo(200, 0);
    expect(walk?.cost).toBeCloseTo(300, 0);
  });

  it("gives the same route for the same input", () => {
    const graph = block(50);
    const first = route(graph, at(10, 3), at(190, 45));
    const second = route(graph, at(10, 3), at(190, 45));
    expect(second).toEqual(first);
  });

  it("walks within one edge when both ends are on it", () => {
    const walk = route(block(40), at(20, 0), at(70, 0));
    expect(walk?.nodes).toEqual([]);
    expect(walk?.lengthM).toBeCloseTo(50, 0);
  });

  it("goes around a node it may not enter", () => {
    const graph = buildWalkGraph([
      road("path", "footway", [at(0, 0), at(100, 0), at(200, 0)]),
      road("minor_road", "residential", [
        at(0, 0),
        at(0, -60),
        at(200, -60),
        at(200, 0),
      ]),
    ]);
    const fog = at(100, 0);
    const walk = routeOnGraph(
      graph,
      position(graph, at(0, 0)),
      position(graph, at(200, 0)),
      { canEnter: (point) => distanceM(point, fog) > 1 },
    );
    expect(walk?.lengthM).toBeCloseTo(320, 0);
    expect(walk?.nodes).not.toContain(nodeAt(graph, fog));
  });

  it("finds no route between pieces that do not touch", () => {
    const graph = buildWalkGraph([
      road("path", "footway", [at(0, 0), at(100, 0)]),
      road("path", "footway", [at(0, 100), at(100, 100)]),
    ]);
    expect(route(graph, at(0, 0), at(100, 100))).toBeNull();
  });

  it("starts and ends at the snapped points", () => {
    const walk = route(block(40), at(50, 2), at(150, 2));
    expect(walk?.points[0]).toEqual(position(block(40), at(50, 2)).point);
    expect(walk?.points.at(-1)).toEqual(position(block(40), at(150, 2)).point);
  });
});

describe("reachFrom", () => {
  const graph = buildWalkGraph([
    road("minor_road", "residential", [at(0, 0), at(200, 0)]),
    road("path", "footway", [at(0, 0), at(0, 40), at(200, 40), at(200, 0)]),
    road("path", "footway", [at(300, 0), at(400, 0)]),
  ]);
  const start = position(graph, at(0, 0));

  it("agrees with routeOnGraph for every node", () => {
    const reach = reachFrom(graph, start);
    graph.nodes.forEach((node, index) => {
      const walk = routeOnGraph(graph, start, position(graph, node));
      if (walk === null) {
        expect(reach.cost[index]).toBe(Infinity);
      } else {
        expect(reach.cost[index]).toBeCloseTo(walk.cost, 6);
        expect(reach.lengthM[index]).toBeCloseTo(walk.lengthM, 6);
      }
    });
  });

  it("leaves nodes past the cost limit, or behind a gate, unreached", () => {
    const far = nodeAt(graph, at(200, 0));
    expect(reachFrom(graph, start, { maxCost: 100 }).cost[far]).toBe(Infinity);
    const corner = at(0, 40);
    const gated = reachFrom(graph, start, {
      canEnter: (point) => distanceM(point, corner) > 1,
    });
    expect(gated.cost[nodeAt(graph, corner)]).toBe(Infinity);
    expect(gated.cost[far]).toBeCloseTo(300, 0);
  });
});
