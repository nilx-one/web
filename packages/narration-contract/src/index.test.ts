// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from "vitest";

import { admitFragments, type CellEvidence } from "./index";

const CELL = "891fb46622fffff";
const OTHER = "891fb46623fffff";
const FROM = 1_767_225_600_000;
const TO = FROM + 12 * 60_000;

const evidence: readonly CellEvidence[] = [
  { cell: CELL, from: FROM, to: TO, kind: "visit" },
];

describe("admitting narration against its evidence", () => {
  it("keeps a fragment about an offered cell at a moment inside it", () => {
    const fragment = { cell: CELL, at: FROM, text: "14:00–14:12 — 12 хвилин." };

    expect(admitFragments(evidence, [fragment])).toEqual({
      fragments: [fragment],
      rejected: [],
    });
  });

  it("drops narration of ground that was never offered", () => {
    const invented = { cell: OTHER, at: FROM, text: "Тут теж було." };

    expect(admitFragments(evidence, [invented])).toEqual({
      fragments: [],
      rejected: [{ reason: "cell_not_offered", cell: OTHER }],
    });
  });

  it("drops a moment outside the visit it claims to describe", () => {
    const stretched = { cell: CELL, at: TO + 60_000, text: "Пізніше." };

    expect(admitFragments(evidence, [stretched]).rejected).toEqual([
      { reason: "moment_outside_evidence", cell: CELL, at: TO + 60_000 },
    ]);
  });

  it("treats an open visit as extending to now rather than ending at its start", () => {
    const open: readonly CellEvidence[] = [
      { cell: CELL, from: FROM, to: null, kind: "visit" },
    ];
    const later = { cell: CELL, at: FROM + 3 * 60_000, text: "Ще тут." };

    expect(admitFragments(open, [later]).fragments).toEqual([later]);
  });

  it("drops an empty sentence instead of rendering silence as narration", () => {
    expect(
      admitFragments(evidence, [{ cell: CELL, at: FROM, text: "  " }]).rejected,
    ).toEqual([{ reason: "empty_text", cell: CELL }]);
  });
});
