// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  canPickUp,
  epochOf,
  FIND_PACK_ID,
  isFindPerceptible,
  rollAlong,
  ROLL_TABLE,
} from "@nilx-one/artifact-contract";
import {
  mapDistanceMeters,
  type MapArea,
  type MapLandmark,
  type MapPointSelection,
} from "@nilx-one/map-contract";
import { buildWalkGraph } from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";

import { startWalk, walkedSoFar } from "./avaia-walk";
import {
  DRIVE_REFS_LIMIT,
  DriveRefs,
  findsAlong,
  passingThings,
  strollNodes,
  wanderNodes,
  wayAhead,
} from "./drive-world";

const ORIGIN = { longitude: 30.5234, latitude: 50.4501 };
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN.latitude * Math.PI) / 180);
const at = (x: number, y: number): MapPointSelection => ({
  longitude: ORIGIN.longitude + x * M_LON,
  latitude: ORIGIN.latitude + y * M_LAT,
});
const lonLat = (x: number, y: number) => {
  const p = at(x, y);
  return [p.longitude, p.latitude] as [number, number];
};
const xOf = (point: MapPointSelection) =>
  Math.round((point.longitude - ORIGIN.longitude) / M_LON);

const graph = buildWalkGraph([
  {
    kind: "path",
    kindDetail: "footway",
    lines: [[0, 50, 100, 150, 200, 250, 300].map((x) => lonLat(x, 0))],
  },
]);

describe("refs the drive is handed", () => {
  it("names the same thing the same way, and a new tap anew", () => {
    const refs = new DriveRefs();
    const statue: MapLandmark = {
      id: "poi:1",
      ...at(10, 10),
      kind: "statue",
      facts: {},
    };
    expect(refs.landmark(statue)).toBe("lm:poi:1");
    expect(refs.landmark(statue)).toBe("lm:poi:1");
    expect(refs.tap(at(1, 1))).toBe("b:1");
    expect(refs.tap(at(1, 1))).toBe("b:2");
    expect(refs.point(at(0, 0), "home")).toBe("home");
    expect(refs.get("lm:poi:1")).toMatchObject({ kind: "landmark" });
    expect(refs.get("lm:unknown")).toBeUndefined();
  });

  it("forgets the oldest past its limit", () => {
    const refs = new DriveRefs();
    const first = refs.tap(at(0, 0));
    for (let i = 0; i < DRIVE_REFS_LIMIT; i++) refs.tap(at(i, 0));
    expect(refs.get(first)).toBeUndefined();
  });
});

describe("where a stroll or a wander may go", () => {
  it("offers nodes in step and on the leash, in graph order", () => {
    const nodes = strollNodes({
      graph,
      from: at(150, 0),
      anchor: at(0, 0),
      minM: 30,
      maxM: 120,
      leashM: 200,
    });
    // 250 is in step from 150 but past the leash from 0.
    expect(nodes.map(xOf).sort((a, b) => a - b)).toEqual([50, 100, 200]);
  });

  it("finds the way back to a path nearby, and offers nothing with none", () => {
    expect(
      strollNodes({
        graph,
        from: at(100, 60),
        anchor: at(100, 60),
        minM: 30,
        maxM: 120,
        leashM: 200,
      }).map(xOf),
    ).toEqual([100]);
    expect(
      strollNodes({
        graph,
        from: at(100, 200),
        anchor: at(100, 200),
        minM: 30,
        maxM: 120,
        leashM: 200,
      }),
    ).toEqual([]);
  });

  it("offers wander nodes within its range", () => {
    expect(
      wanderNodes({ graph, from: at(0, 0), range: [140, 400] }).map(xOf),
    ).toEqual([150, 200, 250, 300]);
  });
});

describe("finds laid on a walk", () => {
  // A long straight walk passes enough segments to roll some finds.
  const path = [at(0, 0), at(20_000, 0)];
  const now = Date.UTC(2026, 9, 7, 12);

  it("lays every find the Avaia sees and may pick up near the walk", () => {
    const placed = findsAlong(path, now);
    const expected = rollAlong(
      path.map((p) => [p.longitude, p.latitude] as const),
      {
        packId: FIND_PACK_ID,
        packVersion: ROLL_TABLE.version,
        epoch: epochOf(now),
      },
    ).filter((roll) => isFindPerceptible(roll) && canPickUp(roll, "avaia"));
    expect(placed.map((find) => find.roll.artifactId)).toEqual(
      expected.map((roll) => roll.artifactId),
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const { roll, point } of placed) {
      // Within the find's own offset of the walk, on the side it rolled.
      const off = (point.latitude - ORIGIN.latitude) / M_LAT;
      expect(
        Math.abs(Math.abs(off) - Math.abs(roll.placement.across) * 25),
      ).toBeLessThan(0.5);
      expect(point.longitude).toBeGreaterThanOrEqual(ORIGIN.longitude);
    }
  });

  it("is the same for the same walk", () => {
    expect(findsAlong(path, now)).toEqual(findsAlong(path, now));
    expect(findsAlong([at(0, 0)], now)).toEqual([]);
  });
});

describe("what a walk passes", () => {
  const ahead = [at(0, 0), at(300, 0)];
  const statue: MapLandmark = {
    id: "poi:9",
    ...at(30, 12),
    kind: "statue",
    facts: {},
  };

  it("reports sights ahead and near the way, with how far off it they lie", () => {
    const refs = new DriveRefs();
    const far: MapLandmark = { ...statue, id: "poi:far", ...at(30, 60) };
    const later: MapLandmark = { ...statue, id: "poi:later", ...at(200, 5) };
    const lake: MapArea = {
      id: "water:1",
      layer: "water",
      kind: "lake",
      name: "Lake",
      label: at(20, -60),
      polygons: [
        [
          [
            lonLat(0, -20),
            lonLat(40, -20),
            lonLat(40, -100),
            lonLat(0, -100),
            lonLat(0, -20),
          ],
        ],
      ],
    };
    const things = passingThings({
      refs,
      ahead,
      landmarks: [statue, far, later],
      areas: [lake],
      finds: [],
      studyable: new Set(["poi:9"]),
    });
    expect(things).toEqual([
      {
        ref: "lm:poi:9",
        kind: "statue",
        group: "landmark",
        off_route_m: 12,
        studyable: true,
      },
      { ref: "a:water:1", kind: "lake", group: "area", off_route_m: 20 },
    ]);
    // The lake is stood at from its shore nearest the way.
    expect(
      mapDistanceMeters(refs.get("a:water:1")!.point, at(0, -20)),
    ).toBeLessThan(1);
  });

  it("leaves out what is not a kind code", () => {
    expect(
      passingThings({
        refs: new DriveRefs(),
        ahead,
        landmarks: [{ ...statue, kind: "Say 7" }],
        areas: [],
        finds: [],
        studyable: new Set(),
      }),
    ).toEqual([]);
  });

  it("is only what is still ahead of the body", () => {
    const walk = startWalk({
      from: at(0, 0),
      to: at(300, 0),
      path: [at(0, 0), at(100, 0), at(300, 0)],
      nowMs: 0,
      zoom: 17,
    });
    const rest = wayAhead(walk.path, walk.along, 150, at(150, 0));
    expect(rest.map(xOf)).toEqual([150, 300]);
  });
});

describe("a walk cut short", () => {
  it("is what was walked of it, up to where the body is", () => {
    const walk = startWalk({
      from: at(0, 0),
      to: at(300, 0),
      path: [at(0, 0), at(100, 0), at(300, 0)],
      nowMs: 0,
      zoom: 17,
    });
    const half = walkedSoFar(walk, walk.durationMs / 2)!;
    expect(half.path.map(xOf)).toEqual([0, 100, 150]);
    expect(half.along.at(-1)).toBeCloseTo(150, 0);
    expect(walkedSoFar(walk, 0)).toBeUndefined();
    expect(walkedSoFar(walk, walk.durationMs)).toBe(walk);
  });
});
