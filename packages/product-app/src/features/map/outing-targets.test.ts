// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  buildWalkGraph,
  distanceM,
  type LonLat,
  type RoadFeature,
} from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";

import {
  chooseByModel,
  chooseByRule,
  MENU_TARGETS,
  menuForModel,
  outingMenu,
  type OutingCandidate,
  type OutingMenu,
  type OutingMenuInput,
} from "./outing-targets";

const ORIGIN: LonLat = [30.5234, 50.4501];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
/** `x` metres east and `y` metres north of the origin. */
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];
const metres = ([lon, lat]: LonLat): [number, number] => [
  (lon - ORIGIN[0]) / M_LON,
  (lat - ORIGIN[1]) / M_LAT,
];

const footway = (...points: [number, number][]): RoadFeature => ({
  kind: "path",
  kindDetail: "footway",
  lines: [points.map(([x, y]) => at(x, y))],
});

const square = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): readonly LonLat[] => [
  at(x0, y0),
  at(x1, y0),
  at(x1, y1),
  at(x0, y1),
  at(x0, y0),
];

const point = (
  id: string,
  kind: string,
  x: number,
  y: number,
  name: string | null = id,
): OutingCandidate => ({
  id,
  kind,
  name: name ?? undefined,
  geometry: { type: "point", point: at(x, y) },
});

const area = (
  id: string,
  kind: string,
  ring: readonly LonLat[],
): OutingCandidate => ({
  id,
  kind,
  name: id,
  geometry: { type: "area", polygons: [[ring]] },
});

// A street along y = 0 from 0 to 1000 m, a footway north into a park, and a
// lakeside path along the lake's south shore.
const graph = buildWalkGraph([
  footway([0, 0], [1000, 0]),
  footway([200, 0], [200, 150]),
  footway([600, 0], [600, 90], [800, 90]),
]);

function menu(
  candidates: readonly OutingCandidate[],
  overrides: Partial<OutingMenuInput> = {},
): OutingMenu {
  return outingMenu({
    candidates,
    graph,
    from: at(0, 0),
    budgetMeters: 3_000,
    ...overrides,
  });
}

const targetIds = (built: OutingMenu) =>
  built.options.flatMap((option) =>
    option.kind === "target" ? [option.target.id] : [],
  );

describe("outingMenu", () => {
  it("is stay and wander with nothing to go to", () => {
    expect(menu([]).options).toEqual([{ kind: "stay" }, { kind: "wander" }]);
  });

  it("is only stay when the Avaia is nowhere near the graph", () => {
    expect(
      menu([point("museum", "museum", 300, 10)], { from: at(0, 500) }).options,
    ).toEqual([{ kind: "stay" }]);
  });

  it("offers one reachable target between stay and wander", () => {
    const built = menu([point("museum", "museum", 300, 10)]);
    expect(built.options.map((option) => option.kind)).toEqual([
      "stay",
      "target",
      "wander",
    ]);
    const target = built.options[1];
    expect(target?.kind === "target" && target.target.meters).toBeCloseTo(
      300,
      0,
    );
  });

  it("offers only named walk targets the graph reaches within 30 m", () => {
    const built = menu([
      point("named", "museum", 300, 10),
      point("unnamed", "museum", 320, 10, null),
      point("blank", "museum", 340, 10, "  "),
      point("off-graph", "castle", 400, 45),
      // A route landmark and a find are not walk targets.
      point("church", "church", 420, 5),
      point("find", "artifact", 440, 5),
    ]);
    expect(targetIds(built)).toEqual(["named"]);
  });

  it("leaves out what is past the budget, excluded, or behind the fog", () => {
    const candidates = [
      point("near", "museum", 300, 5),
      point("far", "castle", 900, 5),
    ];
    expect(targetIds(menu(candidates, { budgetMeters: 500 }))).toEqual([
      "near",
    ]);
    expect(targetIds(menu(candidates, { exclude: new Set(["near"]) }))).toEqual(
      ["far"],
    );
    const fog = (p: LonLat) => metres(p)[0] < 500;
    expect(targetIds(menu(candidates, { open: fog }))).toEqual(["near"]);
  });

  it("bounds the search by the budget without losing a dear but short way", () => {
    // Only a major road leads there: 900 m that cost three times as much.
    const road = buildWalkGraph([
      {
        kind: "major_road",
        kindDetail: "primary",
        lines: [[at(0, 0), at(2000, 0)]],
      },
    ]);
    const candidates = [
      point("within", "museum", 900, 5),
      point("beyond", "castle", 1100, 5),
    ];
    expect(
      targetIds(menu(candidates, { graph: road, budgetMeters: 1_000 })),
    ).toEqual(["within"]);
  });

  it("arrives at a park from inside or near its edge, not its centroid", () => {
    const park = area("park", "park", square(150, 100, 450, 400));
    const built = menu([park]);
    const option = built.options[1];
    if (option?.kind !== "target") throw new Error("no park on the menu");
    const [x, y] = metres(option.target.anchor);
    expect(x).toBeCloseTo(200, 0);
    expect(y).toBeGreaterThanOrEqual(70);
    expect(distanceM(option.target.anchor, at(300, 250))).toBeGreaterThan(50);
  });

  it("arrives at a lake on the shore, never in the water", () => {
    const lake = area("lake", "lake", square(580, 100, 820, 300));
    const option = menu([lake]).options[1];
    if (option?.kind !== "target") throw new Error("no lake on the menu");
    const [x, y] = metres(option.target.anchor);
    expect(y).toBeLessThan(100);
    expect(y).toBeGreaterThanOrEqual(70);
    expect(x).toBeGreaterThanOrEqual(580);
  });

  it("does not offer a lake whose shore no path comes near", () => {
    const lake = area("lake", "lake", square(100, 300, 300, 500));
    expect(targetIds(menu([lake]))).toEqual([]);
  });

  it("takes one of each kind before a second of any, nearest first", () => {
    const museums = [1, 2, 3, 4, 5].map((n) =>
      point(`museum-${n}`, "museum", 100 * n, 5),
    );
    const castle = point("castle", "castle", 900, 5);
    const built = menu([...museums, castle]);
    const ids = targetIds(built);
    expect(ids).toHaveLength(MENU_TARGETS);
    expect(ids).toContain("castle");
    expect(ids).toEqual(["museum-1", "museum-2", "museum-3", "castle"]);
    expect(built.options).toHaveLength(MENU_TARGETS + 2);
  });

  it("is the same menu whatever order the candidates come in", () => {
    const candidates = [
      point("a", "museum", 300, 5),
      point("b", "castle", 700, 5),
      area("park", "park", square(150, 100, 450, 400)),
      area("lake", "lake", square(580, 100, 820, 300)),
    ];
    expect(menu([...candidates].reverse())).toEqual(menu(candidates));
  });
});

describe("choosing", () => {
  const built = menu([
    point("museum", "museum", 300, 5),
    point("castle", "castle", 2_500, 5),
  ]);

  it("goes to the nearest target by rule, else wanders, else stays", () => {
    const pick = chooseByRule(built);
    expect(pick.kind === "target" && pick.target.id).toBe("museum");
    expect(chooseByRule(menu([]))).toEqual({ kind: "wander" });
    expect(chooseByRule({ options: [{ kind: "stay" }] })).toEqual({
      kind: "stay",
    });
  });

  it("shows the model closed labels and nothing else", () => {
    const view = menuForModel(built);
    expect(view).toEqual([
      { index: 0, label: "stay" },
      { index: 1, label: "museum", reach: "near" },
      { index: 2, label: "wander" },
    ]);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/\d+\.\d{3,}/);
    expect(text).not.toContain("castle");
  });

  it("takes the model's pick only when it is an index on the menu", () => {
    expect(chooseByModel(built, 0)).toEqual({ kind: "stay" });
    expect(chooseByModel(built, 2)).toEqual({ kind: "wander" });
    for (const invalid of [7, -1, 1.5, "1", null, undefined, { index: 1 }]) {
      expect(chooseByModel(built, invalid)).toEqual(chooseByRule(built));
    }
  });
});
