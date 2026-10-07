// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  buildWalkGraph,
  reachFrom,
  snapToGraph,
  type LonLat,
} from "@nilx-one/walk-graph";
import { describe, expect, it } from "vitest";

import {
  chooseOuting,
  ENERGY_PER_KM,
  initialDrive,
  LOW_ENERGY,
  MAX_OUTING_METERS,
  nextOutingAt,
  OUTING_INTERVAL_MS,
  outingBudgetMeters,
  POINT_B_STAND_MS,
  recentlyVisited,
  restlessness,
  RESTLESS_MS,
  REVISIT_MS,
  stepDrive,
  VISIT_MS,
  WANDER_MAX_METERS,
  WANDER_MIN_METERS,
  wanderPoint,
  type DriveEvent,
  type DriveState,
} from "./outing-drive";
import type { OutingMenu, OutingTarget } from "./outing-targets";
import {
  emptyAffinity,
  enjoyment,
  LOVED_RETURN_MS,
  recordVisit,
  type PlaceAffinity,
} from "./place-affinity";

const T0 = 1_000_000;

function play(state: DriveState, ...events: DriveEvent[]): DriveState {
  return events.reduce(stepDrive, state);
}

const ORIGIN: LonLat = [30.5234, 50.4501];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];

const target = (id: string, meters: number): OutingTarget => ({
  id,
  kind: "museum",
  name: id,
  anchor: at(meters, 0),
  meters,
});

const menuOf = (...targets: OutingTarget[]): OutingMenu => ({
  options: [
    { kind: "stay" },
    ...targets.map((t) => ({ kind: "target" as const, target: t })),
    { kind: "wander" },
  ],
});

describe("stepDrive", () => {
  it("walks an outing out, looks around, and idles there", () => {
    const out = play(
      initialDrive(T0),
      { type: "set_off", at: T0 + 1, purpose: "outing", targetId: "museum" },
      { type: "arrived", at: T0 + 100, meters: 1_000 },
    );
    expect(out.activity).toEqual({
      kind: "standing",
      reason: "visit",
      until: T0 + 100 + VISIT_MS,
    });
    expect(out.visited).toEqual({ museum: T0 + 100 });
    expect(out.lastOutingAt).toBe(T0 + 1);
    expect(out.energy).toBeCloseTo(1 - ENERGY_PER_KM, 6);

    const later = play(out, { type: "tick", at: T0 + 100 + VISIT_MS });
    expect(later.activity).toEqual({
      kind: "idle",
      since: T0 + 100 + VISIT_MS,
    });
  });

  it("stands at a tapped point B, then carries on from there", () => {
    const tapped = play(
      initialDrive(T0),
      { type: "tap", at: T0 + 1 },
      { type: "arrived", at: T0 + 50, meters: 200 },
    );
    expect(tapped.activity).toEqual({
      kind: "standing",
      reason: "point_b",
      until: T0 + 50 + POINT_B_STAND_MS,
    });
    // Still standing just before the time is up: the drive does not move it.
    const early = play(tapped, {
      type: "tick",
      at: T0 + 49 + POINT_B_STAND_MS,
    });
    expect(early.activity.kind).toBe("standing");
    expect(
      play(early, {
        type: "set_off",
        at: T0 + 49 + POINT_B_STAND_MS,
        purpose: "home",
      }).activity.kind,
    ).toBe("standing");
    // Then idle at B; nothing sends it home.
    const free = play(tapped, { type: "tick", at: T0 + 50 + POINT_B_STAND_MS });
    expect(free.activity).toEqual({
      kind: "idle",
      since: T0 + 50 + POINT_B_STAND_MS,
    });
  });

  it("lets a tap interrupt a walk, a stand at B, or a visit", () => {
    const walking = play(initialDrive(T0), {
      type: "set_off",
      at: T0,
      purpose: "wander",
    });
    const standing = play(
      initialDrive(T0),
      { type: "tap", at: T0 },
      { type: "arrived", at: T0 + 10, meters: 10 },
    );
    const visiting = play(
      initialDrive(T0),
      { type: "set_off", at: T0, purpose: "outing", targetId: "a" },
      { type: "arrived", at: T0 + 10, meters: 10 },
    );
    for (const state of [walking, standing, visiting]) {
      expect(play(state, { type: "tap", at: T0 + 20 }).activity).toEqual({
        kind: "walking",
        purpose: "tap",
        since: T0 + 20,
      });
    }
  });

  it("never lets the drive set off over a walk under way", () => {
    const tapWalk = play(initialDrive(T0), { type: "tap", at: T0 });
    expect(
      play(tapWalk, { type: "set_off", at: T0 + 1, purpose: "outing" }),
    ).toBe(tapWalk);
  });

  it("idles where it stopped when a walk ends without arriving", () => {
    const stopped = play(
      initialDrive(T0),
      { type: "set_off", at: T0, purpose: "wander" },
      { type: "stopped", at: T0 + 5 },
    );
    expect(stopped.activity).toEqual({ kind: "idle", since: T0 + 5 });
    // A stand cut short, when the Avaia leaves the wheel, idles too.
    const standing = play(
      initialDrive(T0),
      { type: "tap", at: T0 },
      { type: "arrived", at: T0 + 1, meters: 10 },
      { type: "stopped", at: T0 + 2 },
    );
    expect(standing.activity).toEqual({ kind: "idle", since: T0 + 2 });
    // Stopping when nothing is going on changes nothing.
    expect(stepDrive(stopped, { type: "stopped", at: T0 + 6 })).toBe(stopped);
  });

  it("recharges at home, and tires per kilometre elsewhere", () => {
    const tired = play(
      initialDrive(T0),
      { type: "set_off", at: T0, purpose: "wander" },
      { type: "arrived", at: T0 + 1, meters: 4_000 },
    );
    expect(tired.energy).toBeCloseTo(1 - 4 * ENERGY_PER_KM, 6);
    const home = play(
      tired,
      { type: "set_off", at: T0 + 2, purpose: "home" },
      { type: "arrived", at: T0 + 3, meters: 500 },
    );
    expect(home.energy).toBe(1);
  });

  it("is deterministic: the same events give the same state", () => {
    const events: DriveEvent[] = [
      { type: "tap", at: T0 },
      { type: "arrived", at: T0 + 10, meters: 300 },
      { type: "tick", at: T0 + 10 + POINT_B_STAND_MS },
      {
        type: "set_off",
        at: T0 + 20 + POINT_B_STAND_MS,
        purpose: "outing",
        targetId: "x",
      },
      { type: "arrived", at: T0 + 30 + POINT_B_STAND_MS, meters: 700 },
    ];
    expect(play(initialDrive(T0), ...events)).toEqual(
      play(initialDrive(T0), ...events),
    );
  });
});

describe("when to go out", () => {
  it("waits until restless, and never twice within the interval", () => {
    const fresh = initialDrive(T0);
    expect(restlessness(fresh, T0)).toBe(0);
    expect(restlessness(fresh, T0 + RESTLESS_MS)).toBe(1);
    expect(nextOutingAt(fresh)).toBe(T0 + RESTLESS_MS);

    const stayed = play(fresh, { type: "stayed", at: T0 + RESTLESS_MS });
    expect(nextOutingAt(stayed)).toBe(T0 + RESTLESS_MS + OUTING_INTERVAL_MS);

    const restored = initialDrive(T0, T0 - OUTING_INTERVAL_MS / 2);
    expect(nextOutingAt(restored)).toBe(T0 + OUTING_INTERVAL_MS / 2);
  });

  it("does not want to go out while busy", () => {
    expect(
      nextOutingAt(play(initialDrive(T0), { type: "tap", at: T0 })),
    ).toBeNull();
    expect(
      restlessness(
        play(initialDrive(T0), { type: "tap", at: T0 }),
        T0 + RESTLESS_MS,
      ),
    ).toBe(0);
  });

  it("plans a there-and-back on the energy left, never past the cap", () => {
    // A full charge is 5 km: 2.5 km out and back, inside the cap.
    expect(outingBudgetMeters(initialDrive(T0))).toBeCloseTo(2_500, 6);
    expect(outingBudgetMeters(initialDrive(T0))).toBeLessThanOrEqual(
      MAX_OUTING_METERS,
    );
    const half = { ...initialDrive(T0), energy: 0.4 };
    expect(outingBudgetMeters(half)).toBeCloseTo(1_000, 6);
  });

  it("leaves recent visits off the menu for a week", () => {
    const state = {
      ...initialDrive(T0),
      visited: { old: T0 - REVISIT_MS, new: T0 - 1 },
    };
    expect([...recentlyVisited(state, T0)]).toEqual(["new"]);
  });

  it("goes back to a loved place after a day, and remembers past a reload", () => {
    const { affinity, id } = lovedPark();
    const lastAt = affinity.places[0]!.lastAt;
    const reloaded = initialDrive(lastAt);
    expect([...recentlyVisited(reloaded, lastAt + 1, affinity)]).toEqual([id]);
    expect([
      ...recentlyVisited(reloaded, lastAt + LOVED_RETURN_MS, affinity),
    ]).toEqual([]);
  });

  it("stands at a target as long as the place says", () => {
    const state = play(
      initialDrive(T0),
      { type: "set_off", at: T0, purpose: "outing", targetId: "park" },
      { type: "arrived", at: T0 + 10, meters: 100, stayMs: 99_000 },
    );
    expect(state.activity).toEqual({
      kind: "standing",
      reason: "visit",
      until: T0 + 10 + 99_000,
    });
  });
});

/** A park this Avaia loves, visited daily until it did. */
function lovedPark(): { affinity: PlaceAffinity; id: string } {
  const by = "xdashaai";
  const empty = emptyAffinity(by);
  let id = "";
  for (let index = 0; index < 100 && id === ""; index++) {
    const candidate = `park:${index}`;
    if (enjoyment(empty, { id: candidate, kind: "park" }, 13) >= 0.8) {
      id = candidate;
    }
  }
  let affinity = empty;
  for (let day = 0; day < 6; day++) {
    affinity = recordVisit(
      affinity,
      { id, kind: "park", longitude: 30.5, latitude: 50.4 },
      T0 + day * 86_400_000,
      13,
    ).affinity;
  }
  return { affinity, id };
}

describe("chooseOuting", () => {
  const day = { at: at(0, 0), home: at(0, 0), hour: 13 };

  it("goes to the nearest target by day", () => {
    const pick = chooseOuting(
      initialDrive(T0),
      menuOf(target("near", 500), target("far", 2_000)),
      day,
    );
    expect(pick.kind === "target" && pick.target.id).toBe("near");
  });

  it("keeps to near targets or a wander at night", () => {
    const night = { ...day, hour: 22 };
    expect(
      chooseOuting(initialDrive(T0), menuOf(target("far", 2_000)), night),
    ).toEqual({
      kind: "wander",
    });
    const pick = chooseOuting(
      initialDrive(T0),
      menuOf(target("near", 800), target("far", 2_000)),
      {
        ...day,
        hour: 6,
      },
    );
    expect(pick.kind === "target" && pick.target.id).toBe("near");
  });

  it("goes home when tired and away, not when already there", () => {
    const tired = { ...initialDrive(T0), energy: LOW_ENERGY - 0.01 };
    expect(
      chooseOuting(tired, menuOf(target("a", 300)), { ...day, at: at(500, 0) }),
    ).toEqual({
      kind: "home",
    });
    expect(chooseOuting(tired, menuOf(target("a", 300)), day).kind).toBe(
      "stay",
    );
  });

  it("goes back to a place it loves and misses, over a nearer new one", () => {
    const { affinity, id } = lovedPark();
    const now = affinity.places[0]!.lastAt + 3 * 86_400_000;
    const pick = chooseOuting(
      initialDrive(now),
      menuOf(target("nearby", 300), target(id, 1_500)),
      { ...day, affinity, now },
    );
    expect(pick.kind === "target" && pick.target.id).toBe(id);
  });

  it("still keeps to near targets at night, loved or not", () => {
    const { affinity, id } = lovedPark();
    const now = affinity.places[0]!.lastAt + 3 * 86_400_000;
    const pick = chooseOuting(
      initialDrive(now),
      menuOf(target("nearby", 300), target(id, 1_500)),
      { ...day, hour: 23, affinity, now },
    );
    expect(pick.kind === "target" && pick.target.id).toBe("nearby");
  });

  it("stays when there is nowhere to go", () => {
    expect(
      chooseOuting(initialDrive(T0), { options: [{ kind: "stay" }] }, day),
    ).toEqual({
      kind: "stay",
    });
  });
});

describe("wanderPoint", () => {
  const graph = buildWalkGraph([
    {
      kind: "path",
      kindDetail: "footway",
      lines: [[at(0, 0), at(100, 0), at(200, 0), at(300, 0), at(500, 0)]],
    },
  ]);
  const start = snapToGraph(graph, at(0, 0))!;
  const reach = reachFrom(graph, start);

  it("goes a short walk along the paths, the same for the same seed", () => {
    const point = wanderPoint(graph, reach, 42)!;
    const x = (point[0] - ORIGIN[0]) / M_LON;
    expect(x).toBeGreaterThanOrEqual(WANDER_MIN_METERS - 1);
    expect(x).toBeLessThanOrEqual(WANDER_MAX_METERS + 1);
    expect(wanderPoint(graph, reach, 42)).toEqual(point);
  });

  it("has nowhere to go when nothing lies in range", () => {
    const short = buildWalkGraph([
      { kind: "path", kindDetail: "footway", lines: [[at(0, 0), at(50, 0)]] },
    ]);
    const near = reachFrom(short, snapToGraph(short, at(0, 0))!);
    expect(wanderPoint(short, near, 1)).toBeUndefined();
  });
});
