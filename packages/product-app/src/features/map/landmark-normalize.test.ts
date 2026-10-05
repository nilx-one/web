// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { LonLat } from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";

import {
  footprintM2,
  LANDMARK_GROUPS,
  LANDMARK_MAPPING,
  normalizeLandmarks,
  normalizeName,
  resolveKind,
  type LandmarkKind,
  type SourceCandidate,
} from "./landmark-normalize";
import { outingCandidates } from "./outing-targets";

const ORIGIN: LonLat = [30.5234, 50.4501];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];

/** A closed square `side` metres across with its south-west corner at (x, y). */
const square = (x: number, y: number, side: number): LonLat[] => [
  at(x, y),
  at(x + side, y),
  at(x + side, y + side),
  at(x, y + side),
  at(x, y),
];

const point = (
  sourceId: string,
  matches: LandmarkKind[],
  x: number,
  y: number,
  extra: Partial<SourceCandidate> = {},
): SourceCandidate => ({
  sourceId,
  matches,
  name: sourceId,
  geometry: { type: "point", point: at(x, y) },
  ...extra,
});

const area = (
  sourceId: string,
  matches: LandmarkKind[],
  ring: LonLat[],
  extra: Partial<SourceCandidate> = {},
): SourceCandidate => ({
  sourceId,
  matches,
  name: sourceId,
  geometry: { type: "area", polygons: [[ring]] },
  ...extra,
});

const kinds = (candidates: SourceCandidate[]) =>
  normalizeLandmarks(candidates).map((landmark) => landmark.kind);

describe("the mapping table", () => {
  it("keeps its groups and rows in this order: the order is the precedence", () => {
    expect(LANDMARK_MAPPING.version).toBe("1.0");
    expect(LANDMARK_GROUPS).toEqual({
      walk_target: [
        "park",
        "lake",
        "nature_reserve",
        "viewpoint",
        "beach",
        "peak",
        "castle",
        "fort",
        "archaeological_site",
        "ruins",
        "historic_building",
        "museum",
        "major_monument",
      ],
      route_landmark: [
        "artwork",
        "fountain",
        "bridge",
        "tower",
        "church",
        "small_monument",
        "shrine",
        "cross",
        "spring",
      ],
      micro_interest: [
        "bench",
        "picnic_site",
        "information",
        "bird_hide",
        "cairn",
        "camp_site",
      ],
    });
  });
});

describe("one object, one kind", () => {
  it("takes the group first, then the table row", () => {
    expect(resolveKind(point("a", ["artwork", "museum"], 0, 0))).toBe("museum");
    expect(resolveKind(point("a", ["bench", "fountain"], 0, 0))).toBe(
      "fountain",
    );
    expect(
      resolveKind(
        point("a", ["historic_building", "castle"], 0, 0, {
          historic: true,
        }),
      ),
    ).toBe("castle");
  });

  it("falls to the next row when the first fails its rule", () => {
    // Unnamed: not a walk target, but still an artwork along the way.
    expect(
      resolveKind(point("a", ["museum", "artwork"], 0, 0, { name: undefined })),
    ).toBe("artwork");
    expect(resolveKind(point("a", ["castle"], 0, 0, { name: "  " }))).toBe(
      undefined,
    );
  });
});

describe("significance", () => {
  it("wants a park named and at least a hectare", () => {
    const side = Math.sqrt(LANDMARK_MAPPING.parkMinAreaM2);
    expect(kinds([area("big", ["park"], square(0, 0, side + 1))])).toEqual([
      "park",
    ]);
    expect(kinds([area("small", ["park"], square(0, 0, side - 1))])).toEqual(
      [],
    );
    expect(
      kinds([
        area("nameless", ["park"], square(0, 0, 200), { name: undefined }),
      ]),
    ).toEqual([]);
  });

  it("never makes a historic building out of a building alone", () => {
    expect(kinds([point("b", ["historic_building"], 0, 0)])).toEqual([]);
    expect(
      kinds([point("b", ["historic_building"], 0, 0, { historic: false })]),
    ).toEqual([]);
    expect(
      kinds([point("b", ["historic_building"], 0, 0, { historic: true })]),
    ).toEqual(["historic_building"]);
  });

  it("tells a major monument from a small one", () => {
    const threshold = Math.sqrt(LANDMARK_MAPPING.majorMonumentMinFootprintM2);
    const cases: [SourceCandidate, LandmarkKind][] = [
      [
        point("m", ["major_monument"], 0, 0, { heritage: true }),
        "major_monument",
      ],
      [
        point("m", ["major_monument"], 0, 0, { attraction: true }),
        "major_monument",
      ],
      [
        area("m", ["major_monument"], square(0, 0, threshold + 0.5)),
        "major_monument",
      ],
      [
        area("m", ["major_monument"], square(0, 0, threshold - 0.5)),
        "small_monument",
      ],
      [point("m", ["major_monument"], 0, 0), "small_monument"],
      // Unnamed is never major, whatever else it has.
      [
        point("m", ["major_monument"], 0, 0, {
          name: undefined,
          heritage: true,
        }),
        "small_monument",
      ],
    ];
    for (const [candidate, expected] of cases) {
      expect(resolveKind(candidate)).toBe(expected);
    }
  });
});

describe("geometry", () => {
  it("rejects what is malformed", () => {
    const broken: SourceCandidate[] = [
      point("nan", ["museum"], Number.NaN, 0),
      {
        sourceId: "far",
        matches: ["museum"],
        name: "far",
        geometry: { type: "point", point: [200, 50] },
      },
      area("short-ring", ["park"], square(0, 0, 200).slice(0, 3)),
      // Five points and a real area, but the last is not the first: open.
      area(
        "open-ring",
        ["park"],
        [at(0, 0), at(200, 0), at(200, 200), at(0, 200), at(0, 100)],
      ),
      area("flat", ["park"], [at(0, 0), at(100, 0), at(200, 0), at(0, 0)]),
      {
        sourceId: "stub",
        matches: ["bridge"],
        name: "stub",
        geometry: { type: "line", lines: [[at(0, 0)]] },
      },
    ];
    expect(normalizeLandmarks(broken)).toEqual([]);
  });

  it("keeps area kinds to areas and lines to bridges", () => {
    expect(kinds([point("lake", ["lake"], 0, 0)])).toEqual([]);
    const line = { type: "line" as const, lines: [[at(0, 0), at(80, 0)]] };
    expect(
      kinds([
        { sourceId: "b", matches: ["bridge"], name: "b", geometry: line },
      ]),
    ).toEqual(["bridge"]);
    expect(
      kinds([{ sourceId: "t", matches: ["tower"], name: "t", geometry: line }]),
    ).toEqual([]);
  });

  it("measures an area less its holes", () => {
    const outer = square(0, 0, 200);
    const hole = square(50, 50, 100);
    expect(
      footprintM2({ type: "area", polygons: [[outer, hole]] }),
    ).toBeCloseTo(40_000 - 10_000, -2);
  });
});

describe("deduplication", () => {
  it("collapses the same kind close by, under a name that agrees", () => {
    expect(
      kinds([
        point("a", ["museum"], 0, 0, { name: "Museum of Water" }),
        point("b", ["museum"], 30, 0, { name: "museum  of water!" }),
      ]),
    ).toEqual(["museum"]);
    // One unnamed: the same feature.
    expect(
      kinds([
        point("a", ["fountain"], 0, 0),
        point("b", ["fountain"], 30, 0, { name: undefined }),
      ]),
    ).toEqual(["fountain"]);
  });

  it("keeps them apart past 50 m, under other names, or as other kinds", () => {
    const limit = LANDMARK_MAPPING.duplicateWithinMeters;
    expect(
      kinds([
        point("a", ["museum"], 0, 0),
        point("a", ["museum"], limit - 1, 0),
      ]),
    ).toHaveLength(1);
    expect(
      kinds([
        point("a", ["museum"], 0, 0, { name: "same" }),
        point("b", ["museum"], limit + 1, 0, { name: "same" }),
      ]),
    ).toHaveLength(2);
    expect(
      kinds([point("a", ["museum"], 0, 0), point("b", ["museum"], 10, 0)]),
    ).toHaveLength(2);
    expect(
      kinds([point("a", ["museum"], 0, 0), point("a", ["castle"], 10, 0)]),
    ).toHaveLength(2);
  });

  it("collapses a point inside a polygon however far from its middle", () => {
    const park = area("park", ["park"], square(0, 0, 600));
    const gate = point("gate", ["park"], 10, 10, { name: "park" });
    // The point alone is not an area, so it is no park; as a duplicate it
    // would not survive anyway. Use a kind that may be both.
    const castle = area("castle", ["castle"], square(0, 0, 600));
    const keep = point("castle", ["castle"], 20, 20);
    expect(kinds([park, gate])).toEqual(["park"]);
    const [only] = normalizeLandmarks([keep, castle]);
    expect(only?.geometry.type).toBe("area");
  });

  it("reads one monument twice as one, the major reading surviving", () => {
    const withHeritage = point("b", ["major_monument"], 10, 0, {
      name: "Founders",
      heritage: true,
    });
    const without = point("a", ["major_monument"], 0, 0, { name: "founders" });
    expect(kinds([without, withHeritage])).toEqual(["major_monument"]);
    expect(kinds([withHeritage, without])).toEqual(["major_monument"]);
  });

  it("keeps the polygon, then the named, then the smallest source id", () => {
    const named = point("z", ["museum"], 0, 0, { name: "m" });
    const unnamed = point("a", ["museum"], 5, 0, { name: undefined });
    expect(normalizeLandmarks([unnamed, named])[0]?.name).toBe("m");

    const first = point("a", ["museum"], 0, 0, { name: "m" });
    const second = point("b", ["museum"], 5, 0, { name: "m" });
    expect(normalizeLandmarks([second, first])).toEqual(
      normalizeLandmarks([first]),
    );
  });
});

describe("normalizeLandmarks", () => {
  const fixture: SourceCandidate[] = [
    area("park-1", ["park"], square(0, 0, 300), { name: "Volodymyr Hill" }),
    point("park-gate", ["park"], 50, 50),
    area("lake-1", ["lake"], square(400, 0, 200), { name: "Lake" }),
    point("mon-1", ["major_monument"], 100, 400, { heritage: true }),
    point("mon-2", ["major_monument"], 110, 400, { name: "mon-1" }),
    point("art-1", ["artwork", "small_monument"], 300, 400, {
      name: undefined,
    }),
    point("bench-1", ["bench"], 320, 400, { name: undefined }),
    point("bad", ["museum"], Number.POSITIVE_INFINITY, 0),
  ];

  it("is the same whatever order the candidates come in", () => {
    expect(normalizeLandmarks([...fixture].reverse())).toEqual(
      normalizeLandmarks(fixture),
    );
  });

  it("matches the golden output for mapping version 1.0", () => {
    expect(LANDMARK_MAPPING.version).toBe("1.0");
    expect(
      normalizeLandmarks(fixture).map(({ id, kind, group, name, geometry }) => [
        id,
        kind,
        group,
        name ?? null,
        geometry.type,
      ]),
    ).toEqual([
      [
        "lm:artwork:3052764:5045370",
        "artwork",
        "route_landmark",
        null,
        "point",
      ],
      ["lm:bench:3052792:5045370", "bench", "micro_interest", null, "point"],
      ["lm:lake:3053046:5045100", "lake", "walk_target", "Lake", "area"],
      [
        "lm:major_monument:3052481:5045370",
        "major_monument",
        "walk_target",
        "mon-1",
        "point",
      ],
      [
        "lm:park:3052552:5045145",
        "park",
        "walk_target",
        "Volodymyr Hill",
        "area",
      ],
    ]);
  });

  it("carries no source id out", () => {
    const text = JSON.stringify(normalizeLandmarks(fixture));
    expect(text).not.toContain("sourceId");
    expect(text).not.toContain("park-1");
    expect(text).not.toContain("art-1");
  });

  it("offers the walk targets to the outing menu, and nothing else", () => {
    const offered = outingCandidates(normalizeLandmarks(fixture));
    expect(offered.map((candidate) => candidate.kind).sort()).toEqual([
      "lake",
      "major_monument",
      "park",
    ]);
  });
});

describe("normalizeName", () => {
  it("folds case, accents, punctuation and spacing", () => {
    expect(normalizeName("  Café «Ромашка»,  Kyiv ")).toBe(
      normalizeName("cafe ромашка kyiv"),
    );
    expect(normalizeName("Ї")).toBe(normalizeName("ї"));
  });
});
