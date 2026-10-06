// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const applyInventory = vi.fn(async () => ({
  ok: true as const,
  state: "",
  seedsGained: 5,
  seedsSpent: 0,
  experience: 0,
}));

vi.mock("./inventory", () => ({
  applyInventory,
  useInventory: () => ({
    model: {
      seeds: 15,
      bond: { carry: "backpack", things: [{ id: "bottle", x: 0, y: 0 }] },
      avaia: { carry: "pocket", things: [{ id: "flyer", x: 2, y: 0 }] },
      craft: undefined,
    },
    catalog: {
      findCatalogVersion: 1,
      economyVersion: 1,
      currency: { code: "seed", emblem: "₴€£" },
      found: [
        {
          id: "bottle",
          tier: 1,
          rarity: "common",
          experience: 10,
          seeds: 0,
          sellPrice: 5,
          size: { width: 1, height: 2 },
        },
        {
          id: "flyer",
          tier: 1,
          rarity: "common",
          experience: 10,
          seeds: 0,
          sellPrice: null,
          size: { width: 1, height: 1 },
        },
      ],
      crafted: [],
      carries: [
        { id: "pocket", width: 5, height: 1 },
        { id: "backpack", width: 8, height: 5 },
        { id: "bag", width: 12, height: 10 },
      ],
    },
  }),
}));

const { InventoryPanel } = await import("./inventory-panel");

const core = { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() };

describe("InventoryPanel", () => {
  it("shows both grids, the balance, and things in their cells", () => {
    render(<InventoryPanel owner="0x0sky" core={core} />);

    expect(screen.getByRole("status")).toHaveTextContent("15 Seed ₴€£");
    const bottle = screen.getByRole("button", { name: "Bottle" });
    expect(bottle.style.gridColumn).toBe("1 / span 1");
    expect(bottle.style.gridRow).toBe("1 / span 2");
    expect(screen.getByRole("region", { name: "Avaia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flyer" }).style.gridColumn).toBe(
      "3 / span 1",
    );
  });

  it("sells what the Bond carries and hands the Avaia's across", async () => {
    render(<InventoryPanel owner="0x0sky" core={core} />);

    fireEvent.click(screen.getByRole("button", { name: "Bottle" }));
    fireEvent.click(screen.getByRole("button", { name: "Sell for 5 ₴€£" }));
    await waitFor(() =>
      expect(applyInventory).toHaveBeenCalledWith("0x0sky", core, {
        op: "sell",
        id: "bottle",
        count: 1,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Flyer" }));
    expect(
      screen.queryByRole("button", { name: /Sell for/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Take from Avaia" }));
    await waitFor(() =>
      expect(applyInventory).toHaveBeenLastCalledWith("0x0sky", core, {
        op: "hand_over",
        from: "avaia",
        x: 2,
        y: 0,
      }),
    );
  });
});
