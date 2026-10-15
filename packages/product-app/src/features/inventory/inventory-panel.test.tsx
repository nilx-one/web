// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  useInventory: vi.fn(() => ({
    model: {
      seeds: 15,
      bond: {
        carry: "backpack",
        things: [{ id: "bottle", x: 0, y: 0 }],
        owned: ["pocket", "backpack"],
      },
      avaia: {
        carry: "pocket",
        things: [{ id: "flyer", x: 0, y: 2 }],
        owned: ["pocket"],
      },
      craft: undefined,
      gifted: true,
    },
    catalog: {
      findCatalogVersion: 1,
      economyVersion: 3,
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
      recipes: [],
      carries: [
        { id: "pocket", width: 1, height: 3, price: null },
        { id: "backpack", width: 3, height: 4, price: 1500 },
        { id: "bag", width: 12, height: 10, price: 5000 },
      ],
    },
  })),
}));

const { InventoryPanel } = await import("./inventory-panel");
const { useInventory } = await import("./inventory");

const core = { applyInventoryCommand: vi.fn(), economyCatalog: vi.fn() };

describe("InventoryPanel", () => {
  it("shows both grids, the balance, and things in their cells", () => {
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);

    expect(screen.getByRole("status")).toHaveTextContent("15 Seed ₴€£");
    const bottle = screen.getByRole("button", { name: "Bottle" });
    expect(bottle.style.gridColumn).toBe("1 / span 1");
    expect(bottle.style.gridRow).toBe("1 / span 2");
    expect(screen.getByRole("region", { name: "Avaia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flyer" }).style.gridColumn).toBe(
      "1 / span 1",
    );
    expect(screen.getByRole("button", { name: "Flyer" }).style.gridRow).toBe(
      "3 / span 1",
    );
  });

  it("frames every carry at 3×4 size: pockets draw their three cells, bags scroll", () => {
    const snapshot = useInventory("0x0sky", core);
    vi.mocked(useInventory).mockReturnValueOnce({
      ...snapshot,
      model: {
        ...snapshot.model,
        bond: { ...snapshot.model.bond, carry: "bag" },
      },
    });
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);

    const holder = (name: string) => {
      const region = screen.getByRole("region", { name });
      const scroller = within(region).getByRole("group");
      return {
        region,
        scroller,
        cells: region.querySelectorAll<HTMLElement>(".inventory__cell"),
      };
    };

    const pocket = holder("Avaia");
    expect(pocket.cells).toHaveLength(3);
    expect([...pocket.cells].map((cell) => cell.style.gridColumn)).toEqual([
      "1",
      "1",
      "1",
    ]);
    expect([...pocket.cells].map((cell) => cell.style.gridRow)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(pocket.region).toHaveTextContent("Pocket — 1×3");
    expect(pocket.region).toHaveTextContent("3 cells");
    expect(
      pocket.scroller.style.getPropertyValue("--inventory-frame-columns"),
    ).toBe("3");

    const bag = holder("You");
    expect(bag.cells).toHaveLength(120);
    expect(bag.region).toHaveTextContent("Bag — 12×10");
    expect(bag.region).toHaveTextContent("120 cells");
    expect(
      bag.scroller.style.getPropertyValue("--inventory-frame-columns"),
    ).toBe("3");
    expect(bag.scroller.style.getPropertyValue("--inventory-frame-rows")).toBe(
      "4",
    );
  });

  it("shows only the opened grid while the Bond and the Avaia are apart", () => {
    render(<InventoryPanel owner="0x0sky" core={core} committed />);

    expect(screen.getByRole("region", { name: "You" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Avaia" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Avaia's things show when you stand together."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bottle" }));
    expect(
      screen.queryByRole("button", { name: "Hand to Avaia" }),
    ).not.toBeInTheDocument();
  });

  it("shows the Avaia's own grid, not the Bond's, when she is opened apart", () => {
    render(
      <InventoryPanel owner="0x0sky" core={core} committed first="avaia" />,
    );

    expect(screen.getByRole("region", { name: "Avaia" })).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "You" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("The Bond's things show when you stand together."),
    ).toBeInTheDocument();
  });

  it("closes a selection on the other's grid when they walk apart", () => {
    const { rerender } = render(
      <InventoryPanel owner="0x0sky" core={core} committed together />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Flyer" }));
    expect(
      screen.getByRole("button", { name: "Take from Avaia" }),
    ).toBeInTheDocument();

    rerender(<InventoryPanel owner="0x0sky" core={core} committed />);
    rerender(<InventoryPanel owner="0x0sky" core={core} committed together />);
    expect(
      screen.queryByRole("button", { name: "Take from Avaia" }),
    ).not.toBeInTheDocument();
  });

  it("does not invent occupied area before the catalog supplies item sizes", () => {
    const snapshot = useInventory("0x0sky", core);
    vi.mocked(useInventory).mockReturnValueOnce({
      ...snapshot,
      catalog: undefined,
    });
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);
    expect(screen.queryByRole("meter")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bottle" })).toBeInTheDocument();
  });

  it("keeps buying and crafting closed for now", () => {
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);

    expect(
      screen.queryByRole("button", { name: /^Buy / }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Craft")).not.toBeInTheDocument();
  });

  it("counts occupied cells, preserves the opened owner, and shows readable names", () => {
    render(
      <InventoryPanel
        owner="0x0sky"
        core={core}
        committed
        together
        first="avaia"
      />,
    );

    expect(screen.getAllByRole("region")[0]).toHaveAccessibleName("Avaia");
    const bond = within(screen.getByRole("region", { name: "You" }));
    expect(bond.getByRole("meter")).toHaveAccessibleName(
      "2 of 12 cells occupied",
    );
    expect(bond.getByRole("meter")).toHaveAttribute("value", "2");
    expect(bond.getByRole("list")).toHaveTextContent("Bottle");
    expect(
      bond.getByRole("button", { name: "Bottle" }),
    ).toHaveAccessibleDescription("Bottle");
  });

  it("keeps item actions in their owner's section and allows closing details", () => {
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);

    fireEvent.click(screen.getByRole("button", { name: "Flyer" }));
    const avaia = within(screen.getByRole("region", { name: "Avaia" }));
    expect(
      avaia.getByRole("button", { name: "Take from Avaia" }),
    ).toBeInTheDocument();
    fireEvent.click(avaia.getByRole("button", { name: "Close item details" }));
    expect(
      screen.queryByRole("button", { name: "Take from Avaia" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flyer" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Flyer" })).toHaveFocus();
  });

  it("offers what each does not own yet, at Core's price", async () => {
    render(
      <InventoryPanel
        owner="0x0sky"
        core={core}
        committed
        together
        shopAndCraft
      />,
    );

    expect(
      screen.getAllByRole("button", { name: "Buy a bag · 5000 ₴€£" }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Buy a backpack · 1500 ₴€£" }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Buy a backpack · 1500 ₴€£" }),
    );
    await waitFor(() =>
      expect(applyInventory).toHaveBeenLastCalledWith("0x0sky", core, {
        op: "buy_carry",
        holder: "avaia",
        carry: "backpack",
      }),
    );
  });

  it("sells what the Bond carries and hands the Avaia's across", async () => {
    render(<InventoryPanel owner="0x0sky" core={core} committed together />);

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
        x: 0,
        y: 2,
      }),
    );
  });
});
