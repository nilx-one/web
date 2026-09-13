// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  admitFragments,
  type CellEvidence,
} from "@nilx-one/narration-contract";
import { describe, expect, it } from "vitest";

import { createTemplateNarrationAdapter } from "./index";

const CELL = "891fb46622fffff";
const FROM = 1_767_225_600_000;

const adapter = createTemplateNarrationAdapter({ timeZone: "UTC" });

function visit(overrides: Partial<CellEvidence> = {}): CellEvidence {
  return {
    cell: CELL,
    from: FROM,
    to: FROM + 12 * 60_000,
    kind: "visit",
    ...overrides,
  };
}

describe("deterministic narration", () => {
  it("is available without a device requirement to report", async () => {
    await expect(adapter.capability()).resolves.toEqual({
      kind: "ready",
      adapter: "deterministic-templates",
    });
  });

  it("states a start, an end and a duration, and nothing else", async () => {
    const [fragment] = await adapter.narrate([visit()]);

    expect(fragment).toEqual({
      cell: CELL,
      at: FROM,
      text: "00:00–00:12 — 12 хвилин.",
    });
  });

  it("does not choose an end for a visit that has not ended", async () => {
    const [fragment] = await adapter.narrate([visit({ to: null })]);

    expect(fragment?.text).toBe("00:00 — ще тут.");
  });

  it("says less than a minute rather than zero minutes", async () => {
    const [fragment] = await adapter.narrate([visit({ to: FROM + 20_000 })]);

    expect(fragment?.text).toBe("00:00 — менше хвилини.");
  });

  it("agrees with Ukrainian plural forms", async () => {
    const durations = [1, 3, 11, 21];
    const texts = await Promise.all(
      durations.map(async (minutes) => {
        const [fragment] = await adapter.narrate([
          visit({ to: FROM + minutes * 60_000 }),
        ]);
        return fragment?.text ?? "";
      }),
    );

    expect(texts.map((text) => text.split(" ").at(-1))).toEqual([
      "хвилина.",
      "хвилини.",
      "хвилин.",
      "хвилина.",
    ]);
  });

  it("orders fragments by when they happened", async () => {
    const later = visit({ from: FROM + 3_600_000, to: FROM + 3_660_000 });
    const fragments = await adapter.narrate([later, visit()]);

    expect(fragments.map((fragment) => fragment.at)).toEqual([
      FROM,
      later.from,
    ]);
  });

  it("produces only fragments its own evidence can carry", async () => {
    const offered = [visit(), visit({ from: FROM + 3_600_000, to: null })];

    const fragments = await adapter.narrate(offered);

    expect(admitFragments(offered, fragments).rejected).toEqual([]);
  });

  it("says the same thing about the same evidence", async () => {
    await expect(adapter.narrate([visit()])).resolves.toEqual(
      await adapter.narrate([visit()]),
    );
  });
});
