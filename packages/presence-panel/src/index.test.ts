// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { PresenceStore, VisitRecord } from "@nilx-one/presence-contract";
import { describe, expect, it } from "vitest";

import { createPresenceJournalPanel } from "./index";

const CELL = "891f1d48a83ffff";

function visit(overrides: Partial<VisitRecord> = {}): VisitRecord {
  return {
    cell: CELL,
    enteredAt: 1_700_000_000_000,
    leftAt: null,
    source: "self",
    fixCount: 5,
    bestAccuracyM: 11.4,
    ...overrides,
  };
}

function storeOf(
  records: readonly VisitRecord[],
  behaviour: "ok" | "fail" | "hang" = "ok",
): PresenceStore {
  return {
    async append() {},
    async listCells() {
      return [CELL];
    },
    async recordsForCell() {
      if (behaviour === "fail") throw new Error("sealed");
      if (behaviour === "hang") return new Promise(() => undefined);
      return records;
    },
    subscribe() {
      return () => undefined;
    },
  };
}

describe("the journal panel", () => {
  it("stays hidden until a cell is tapped", () => {
    const panel = createPresenceJournalPanel(storeOf([]));

    expect(panel.element.hidden).toBe(true);
  });

  it("shows one row per record", async () => {
    const panel = createPresenceJournalPanel(
      storeOf([
        visit({ enteredAt: 0, leftAt: 90_000 }),
        visit({ enteredAt: 200_000 }),
      ]),
    );

    await panel.show(CELL);

    expect(panel.element.hidden).toBe(false);
    expect(panel.element.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("shows entered, left, dwell, fixes and best accuracy", async () => {
    const panel = createPresenceJournalPanel(
      storeOf([
        visit({ enteredAt: 0, leftAt: 90_000, fixCount: 7, bestAccuracyM: 9 }),
      ]),
    );

    await panel.show(CELL);

    const cells = [...panel.element.querySelectorAll("tbody td")].map(
      (cell) => cell.textContent,
    );
    expect(cells).toEqual([
      "1970-01-01T00:00:00.000Z",
      "1970-01-01T00:01:30.000Z",
      "1m30s",
      "7",
      "9m",
    ]);
  });

  it("names the cell it is showing", async () => {
    const panel = createPresenceJournalPanel(storeOf([visit()]));

    await panel.show(CELL);

    expect(panel.element.textContent).toContain(CELL);
  });

  it("says so when a lit cell somehow holds no records", async () => {
    const panel = createPresenceJournalPanel(storeOf([]));

    await panel.show(CELL);

    expect(panel.element.textContent).toContain("no records");
  });

  it("reports a journal it cannot read rather than showing stale rows", async () => {
    const ok = createPresenceJournalPanel(storeOf([visit()]));
    await ok.show(CELL);
    const broken = createPresenceJournalPanel(storeOf([], "fail"));

    await broken.show(CELL);

    expect(broken.element.textContent).toContain("could not be read");
    expect(broken.element.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("clears the previous cell's rows while the next read is in flight", async () => {
    const panel = createPresenceJournalPanel(storeOf([visit()]));
    await panel.show(CELL);
    const hanging = createPresenceJournalPanel(storeOf([], "hang"));

    void hanging.show(CELL);

    expect(hanging.element.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("hides again on close", async () => {
    const panel = createPresenceJournalPanel(storeOf([visit()]));
    await panel.show(CELL);

    panel.element.querySelector("button")?.click();

    expect(panel.element.hidden).toBe(true);
  });

  it("announces itself to assistive technology", () => {
    const panel = createPresenceJournalPanel(storeOf([]));

    expect(panel.element.getAttribute("aria-live")).toBe("polite");
    expect(
      panel.element.querySelector("button")?.getAttribute("aria-label"),
    ).toBeTruthy();
  });

  it("labels its columns as headers", async () => {
    const panel = createPresenceJournalPanel(storeOf([visit()]));

    await panel.show(CELL);

    const headers = [...panel.element.querySelectorAll("thead th")];
    expect(headers).toHaveLength(5);
    expect(
      headers.every((header) => header.getAttribute("scope") === "col"),
    ).toBe(true);
  });
});
