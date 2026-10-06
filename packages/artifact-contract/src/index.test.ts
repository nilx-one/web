// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import {
  epochOf,
  FIND_OFFSET_METERS,
  isFindPerceptible,
  PERCEPTION_METERS,
  rollAlong,
  rollSegment,
  ROLL_TABLE,
  SEGMENT_METERS,
  segmentAt,
  segmentsAlong,
  type EpochId,
  type FindRoll,
  type LonLat,
  type SegmentId,
  type Tier,
} from "./index";

const PACK = { packId: "test", packVersion: 1 } as const;
const EPOCH = "e2960" as const;

const ORIGIN: LonLat = [30.5234, 50.4501];
const M_LAT = 1 / 111_195;
const M_LON = M_LAT / Math.cos((ORIGIN[1] * Math.PI) / 180);
const at = (x: number, y: number): LonLat => [
  ORIGIN[0] + x * M_LON,
  ORIGIN[1] + y * M_LAT,
];

const segment = (row: number, column: number): SegmentId =>
  `seg:${row}:${column}`;

/** Rolls a block of segments `rows` by `columns`, near Kyiv. */
function rollMany(
  rows: number,
  columns: number,
  pack: { packId: string; packVersion: number } = PACK,
  epoch: EpochId = EPOCH,
): (FindRoll | null)[] {
  const rolls: (FindRoll | null)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      rolls.push(
        rollSegment({
          ...pack,
          epoch,
          segment: segment(312_000 + r, 298_000 + c),
        }),
      );
    }
  }
  return rolls;
}

describe("the rarity table", () => {
  it("pays 10 to 1000 experience over six tiers, rarer pays more", () => {
    expect(ROLL_TABLE.tiers.map((rate) => rate.tier)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(ROLL_TABLE.tiers[0]?.experience).toBe(10);
    expect(ROLL_TABLE.tiers[5]?.experience).toBe(1000);
    for (let i = 1; i < ROLL_TABLE.tiers.length; i++) {
      expect(ROLL_TABLE.tiers[i]!.experience).toBeGreaterThan(
        ROLL_TABLE.tiers[i - 1]!.experience,
      );
      expect(ROLL_TABLE.tiers[i]!.perKm).toBeLessThan(
        ROLL_TABLE.tiers[i - 1]!.perKm,
      );
    }
  });

  it("comes to about one find in 2 km and 30 experience a kilometre", () => {
    const perKm = ROLL_TABLE.tiers.reduce((sum, rate) => sum + rate.perKm, 0);
    const xpPerKm = ROLL_TABLE.tiers.reduce(
      (sum, rate) => sum + rate.perKm * rate.experience,
      0,
    );
    expect(1 / perKm).toBeCloseTo(2, 0);
    expect(xpPerKm).toBeGreaterThan(25);
    expect(xpPerKm).toBeLessThan(45);
  });
});

describe("rollSegment", () => {
  it("rolls the same for the same segment, epoch and pack", () => {
    expect(rollMany(20, 50)).toEqual(rollMany(20, 50));
  });

  it("rolls anew in another epoch or with another pack version", () => {
    const base = rollMany(20, 50);
    expect(rollMany(20, 50, PACK, "e2961")).not.toEqual(base);
    expect(rollMany(20, 50, { packId: "test", packVersion: 2 })).not.toEqual(
      base,
    );
  });

  it("mostly finds nothing", () => {
    const rolls = rollMany(20, 50);
    const empty = rolls.filter((roll) => roll === null).length;
    expect(empty / rolls.length).toBeGreaterThan(0.95);
  });

  it("finds each tier at its rate, tier 6 about once in 100 km", () => {
    // 400 000 segments of 50 m: 20 000 km.
    const counts = new Map<Tier, number>();
    for (const roll of rollMany(400, 1000)) {
      if (roll !== null)
        counts.set(roll.tier, (counts.get(roll.tier) ?? 0) + 1);
    }
    const km = (400 * 1000 * SEGMENT_METERS) / 1000;
    for (const rate of ROLL_TABLE.tiers) {
      const expected = rate.perKm * km;
      const found = counts.get(rate.tier) ?? 0;
      expect(Math.abs(found - expected) / expected).toBeLessThan(0.3);
    }
  });

  it("names the find by segment, epoch, pack version and slot", () => {
    const roll = rollMany(20, 50).find((found) => found !== null);
    expect(roll?.artifactId).toBe(`art:${roll?.segment}:${EPOCH}:1:0`);
  });

  it("places a find relative to the walk, never as a coordinate", () => {
    for (const roll of rollMany(40, 50)) {
      if (roll === null) continue;
      expect(Object.keys(roll).sort()).toEqual([
        "artifactId",
        "epoch",
        "experience",
        "packVersion",
        "placement",
        "segment",
        "slot",
        "tier",
      ]);
      expect(roll.placement.along).toBeGreaterThanOrEqual(0);
      expect(roll.placement.along).toBeLessThan(1);
      expect(Math.abs(roll.placement.across)).toBeLessThanOrEqual(1);
    }
  });

  it("sees only placements within the 15 m perception radius", () => {
    const boundary = PERCEPTION_METERS / FIND_OFFSET_METERS;
    expect(
      isFindPerceptible({ placement: { along: 0.5, across: boundary } }),
    ).toBe(true);
    expect(
      isFindPerceptible({
        placement: { along: 0.5, across: boundary + Number.EPSILON * 4 },
      }),
    ).toBe(false);
    expect(
      isFindPerceptible({ placement: { along: 0.5, across: -boundary } }),
    ).toBe(true);
  });

  it("refuses a pack it cannot name finds by", () => {
    const input = { epoch: EPOCH, segment: segment(1, 1) };
    expect(() => rollSegment({ ...input, packId: "", packVersion: 1 })).toThrow(
      RangeError,
    );
    expect(() =>
      rollSegment({ ...input, packId: "a:b", packVersion: 1 }),
    ).toThrow(RangeError);
    expect(() =>
      rollSegment({ ...input, packId: "a", packVersion: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      rollSegment({ ...input, packId: "a", packVersion: 1.5 }),
    ).toThrow(RangeError);
  });

  // The golden snapshot: a change to the table, the grid, the seed or the
  // generator changes it, and must raise ROLL_TABLE.version in the same commit.
  it("matches the golden rolls for table version 1", () => {
    expect(ROLL_TABLE.version).toBe(1);
    const found: FindRoll[] = [];
    for (let r = 0; r < 4000 && found.length < 6; r++) {
      const roll = rollSegment({
        packId: "golden",
        packVersion: 1,
        epoch: "e2900",
        segment: segment(3_000_000 + r, 7000),
      });
      if (roll !== null) found.push(roll);
    }
    expect(
      found.map((roll) => [
        roll.artifactId,
        roll.tier,
        roll.experience,
        roll.placement.along,
        roll.placement.across,
      ]),
    ).toEqual([
      [
        "art:seg:3000042:7000:e2900:1:0",
        1,
        10,
        0.9053420010022819,
        -0.7218878073617816,
      ],
      [
        "art:seg:3000106:7000:e2900:1:0",
        1,
        10,
        0.575726603390649,
        -0.4965639994479716,
      ],
      [
        "art:seg:3000134:7000:e2900:1:0",
        5,
        400,
        0.062402204843237996,
        -0.9192713284865022,
      ],
      [
        "art:seg:3000139:7000:e2900:1:0",
        1,
        10,
        0.6837211933452636,
        0.9136116416193545,
      ],
      [
        "art:seg:3000156:7000:e2900:1:0",
        1,
        10,
        0.009048925479874015,
        0.24597822595387697,
      ],
      [
        "art:seg:3000269:7000:e2900:1:0",
        1,
        10,
        0.4986262572929263,
        -0.797026711050421,
      ],
    ]);
  });
});

describe("segments", () => {
  it("cuts the ground into cells about 50 m across", () => {
    expect(segmentAt(at(0, 0))).toBe(segmentAt(at(0.1, 0.1)));
    // Walking 1 km straight east or north crosses about 20 cells either way.
    for (const end of [at(1000, 0), at(0, 1000)]) {
      const crossed = segmentsAlong([at(0, 0), end]).length;
      expect(crossed).toBeGreaterThanOrEqual(19);
      expect(crossed).toBeLessThanOrEqual(22);
    }
  });

  it("lists each segment once, in the order the walk enters it", () => {
    const there = segmentsAlong([at(0, 0), at(300, 0)]);
    const andBack = segmentsAlong([at(0, 0), at(300, 0), at(0, 0)]);
    expect(andBack).toEqual(there);
    expect(segmentsAlong([at(300, 0), at(0, 0)])).toEqual([...there].reverse());
  });

  // The grid as the package cuts it, to place points by cell.
  const ROW = SEGMENT_METERS / 111_195;
  const COLUMN = ROW * 1.5698;
  const BASE_ROW = 312_346;
  const BASE_COLUMN = 298_243;
  const cellPoint = (x: number, y: number): LonLat => [
    (BASE_COLUMN + x) * COLUMN - 180,
    (BASE_ROW + y) * ROW - 90,
  ];
  const cellId = (x: number, y: number) =>
    segment(BASE_ROW + y, BASE_COLUMN + x);

  it("enters a cell the walk only clips at a corner", () => {
    // Crosses the row edge at x = 0.99: one hundredth of a cell, half a
    // metre, inside cell (0, 1), between any eight samples a cell.
    const from = cellPoint(0.5, 0.755);
    const to = cellPoint(1.5, 1.255);
    expect(segmentsAlong([from, to])).toEqual([
      cellId(0, 0),
      cellId(0, 1),
      cellId(1, 1),
    ]);
  });

  it("steps diagonally through an exact corner", () => {
    expect(segmentsAlong([cellPoint(0.5, 0.5), cellPoint(1.5, 1.5)])).toEqual([
      cellId(0, 0),
      cellId(1, 1),
    ]);
  });

  it("enters every cell a leg passes through, each next to the last", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const jumps: string[] = [];
    const missed: string[] = [];
    for (let leg = 0; leg < 300; leg++) {
      const from = cellPoint(random() * 6, random() * 6);
      const to = cellPoint(random() * 6, random() * 6);
      const cells = segmentsAlong([from, to]);
      const parsed = cells.map((id) => id.split(":").slice(1).map(Number));
      for (let i = 1; i < parsed.length; i++) {
        const [r0 = 0, c0 = 0] = parsed[i - 1]!;
        const [r1 = 0, c1 = 0] = parsed[i]!;
        if (Math.abs(r1 - r0) > 1 || Math.abs(c1 - c0) > 1) {
          jumps.push(`${cells[i - 1]} → ${cells[i]}`);
        }
      }
      // Dense sampling only ever finds cells the exact walk also entered.
      const entered = new Set(cells);
      for (let s = 0; s <= 1000; s++) {
        const t = s / 1000;
        const cell = segmentAt([
          from[0] + (to[0] - from[0]) * t,
          from[1] + (to[1] - from[1]) * t,
        ]);
        if (!entered.has(cell)) missed.push(cell);
      }
    }
    expect(jumps).toEqual([]);
    expect(missed).toEqual([]);
  });

  it("is nothing for an empty walk and one segment for standing still", () => {
    expect(segmentsAlong([])).toEqual([]);
    expect(segmentsAlong([at(5, 5)])).toEqual([segmentAt(at(5, 5))]);
  });
});

describe("rollAlong", () => {
  it("is what each segment of the walk rolls, nothing twice", () => {
    const path = [at(0, 0), at(3000, 0), at(3000, 3000)];
    const finds = rollAlong(path, { ...PACK, epoch: EPOCH });
    const expected = segmentsAlong(path).flatMap((id) => {
      const roll = rollSegment({ ...PACK, epoch: EPOCH, segment: id });
      return roll === null ? [] : [roll];
    });
    expect(finds).toEqual(expected);
    expect(new Set(finds.map((roll) => roll.artifactId)).size).toBe(
      finds.length,
    );
  });

  it("pays nothing more for walking the same street again that week", () => {
    const path = [at(0, 0), at(5000, 0)];
    const once = rollAlong(path, { ...PACK, epoch: EPOCH });
    const twice = rollAlong([...path, at(0, 0)], { ...PACK, epoch: EPOCH });
    expect(twice).toEqual(once);
  });
});

describe("epochOf", () => {
  it("turns over at Monday 00:00 UTC", () => {
    const saturday = Date.UTC(2026, 9, 3, 12);
    const sundayNight = Date.UTC(2026, 9, 4, 23, 59, 59);
    const monday = Date.UTC(2026, 9, 5);
    expect(epochOf(saturday)).toBe(epochOf(sundayNight));
    expect(epochOf(monday)).not.toBe(epochOf(sundayNight));
    expect(epochOf(monday)).toBe("e2961");
  });
});
