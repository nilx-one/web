// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { XpingEngineRead, XpingEngineView } from "@nilx-one/application";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { chooseLocale } from "../../shell/localization";
import { hoursMinutes, XpingSection } from "./xping-section";

beforeEach(() => {
  chooseLocale("en");
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});
afterEach(() => {
  vi.useRealTimers();
  chooseLocale("auto");
});

const read = (view: Partial<XpingEngineView> = {}): XpingEngineRead => ({
  state: { energy_permille: 500, at_ms: "0" },
  view: {
    energyPermille: 500,
    smokePermille: 500,
    broken: false,
    emptyMarginMs: 2_000,
    fullAtMs: 6 * 3_600_000,
    repairSeeds: 25,
    ...view,
  },
  nowMs: 0,
});

it("rounds the time left up to the minute", () => {
  expect(hoursMinutes(1)).toBe("0:01");
  expect(hoursMinutes(6 * 3_600_000)).toBe("6:00");
  expect(hoursMinutes(0)).toBe("0:00");
});

it("shows energy, smoke, when it is full and the repair's price", () => {
  const repair = vi.fn();
  render(
    <XpingSection
      engine={{
        read: read(),
        receivedAt: 100_000,
        busy: false,
        error: undefined,
        repair,
      }}
    />,
  );
  expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("Energy 50% · smoke 50%")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Full again in 6:00");
  fireEvent.click(screen.getByRole("button", { name: "Repair · 25 Seed ₴€£" }));
  expect(repair).toHaveBeenCalledOnce();
});

it("says a broken engine mends itself and when, and why a repair failed", () => {
  render(
    <XpingSection
      engine={{
        read: read({
          energyPermille: 0,
          smokePermille: 1000,
          broken: true,
          fullAtMs: 12 * 3_600_000,
          repairSeeds: 50,
        }),
        receivedAt: 100_000,
        busy: false,
        error: { kind: "refused", reason: "not_enough_seeds" },
        repair: vi.fn(),
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Engine broken · mends itself in 12:00",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Not enough Seed ₴€£ for the repair.",
  );
  expect(
    screen.getByRole("button", { name: "Repair · 50 Seed ₴€£" }),
  ).toBeInTheDocument();
});

it("offers no repair for a full engine", () => {
  render(
    <XpingSection
      engine={{
        read: read({
          energyPermille: 1000,
          smokePermille: 0,
          fullAtMs: undefined,
          repairSeeds: 0,
        }),
        receivedAt: 100_000,
        busy: false,
        error: undefined,
        repair: vi.fn(),
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Engine full");
  expect(screen.queryByRole("button")).toBeNull();
});
