// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const startCraft = vi.fn(async () => ({
  ok: false as const,
  error: "not_enough_seeds",
}));

vi.mock("./craft", () => ({
  startCraft,
  finishCraft: vi.fn(),
  isFinished: () => false,
}));

const { CraftSection } = await import("./craft-section");

const repair = {
  id: "repair_cd_player",
  consumes: [{ id: "broken_cd_player", count: 1 }],
  tools: [],
  seeds: 200,
  makes: "cd_player",
  experience: 50,
  place: "repair_workshop" as const,
  minutes: 45,
  legendary: false,
};
const catalog = {
  findCatalogVersion: 1,
  economyVersion: 1,
  currency: { code: "seed", emblem: "₴€£" },
  found: [],
  crafted: [],
  recipes: [repair],
  carries: [],
};
const model = {
  seeds: 0,
  bond: { carry: "backpack" as const, things: [] },
  avaia: { carry: "backpack" as const, things: [] },
  craft: undefined,
};
const core = { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() };

describe("CraftSection", () => {
  it("asks before starting, then says why Core refused", async () => {
    render(
      <CraftSection
        owner="0x0sky"
        core={core}
        model={model}
        catalog={catalog}
        committed
        place="repair_workshop"
        workshopName="Радіоринок"
      />,
    );

    expect(screen.getByText("Repair: CD player")).toBeInTheDocument();
    expect(
      screen.getByText(/45 min · 200 ₴€£ · \+50 experience/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("At a repair workshop: Радіоринок"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Only at a repair workshop."),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Craft" }));
    expect(startCraft).not.toHaveBeenCalled();
    expect(screen.getByText(/It takes 45 min/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(startCraft).toHaveBeenCalledWith(
        "0x0sky",
        core,
        repair,
        "repair_workshop",
      ),
    );
    expect(await screen.findByText("Not enough Seed ₴€£.")).toBeInTheDocument();
  });

  it("shows the running craft and locks the rest", () => {
    render(
      <CraftSection
        owner="0x0sky"
        core={core}
        model={{
          ...model,
          craft: {
            recipe: "repair_cd_player",
            startedMs: Date.now(),
            readyMs: Date.now() + 45 * 60_000,
          },
        }}
        catalog={catalog}
        committed
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /CD player · ready in 45 min/,
    );
    expect(screen.getByRole("button", { name: "Craft" })).toBeDisabled();
  });
});
