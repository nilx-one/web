// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";
import type { VisitRecord } from "@nilx-one/presence-contract";
import { formatRecords } from "./pick";

const CELL = "891fb46622fffff";

function visit(overrides: Partial<VisitRecord>): VisitRecord {
  return {
    cell: CELL,
    enteredAt: 1_000_000,
    leftAt: null,
    source: "self",
    fixCount: 1,
    bestAccuracyM: 20,
    ...overrides,
  };
}

describe("formatRecords visit folding", () => {
  it("folds the open and closed halves of one visit into a single row", () => {
    const rows = formatRecords([
      visit({ leftAt: null, fixCount: 2, bestAccuracyM: 22 }),
      visit({ leftAt: 1_600_000, fixCount: 9, bestAccuracyM: 12.4 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("10m");
    expect(rows[0]).toContain("9 fixes");
  });

  it("keeps separate visits to the same cell apart", () => {
    const rows = formatRecords([
      visit({ enteredAt: 1_000_000, leftAt: 1_600_000 }),
      visit({ enteredAt: 5_000_000, leftAt: 5_600_000 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});
