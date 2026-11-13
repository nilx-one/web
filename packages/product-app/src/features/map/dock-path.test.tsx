// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BLOCK_EXIT_MS } from "../../shell/weighted-block";
import { DockPath, type DockPathStep } from "./dock-path";

const DOCK: DockPathStep = { id: "dock", label: "Dock", icon: "dock" };
const SETTINGS: DockPathStep = {
  id: "settings",
  label: "Settings",
  icon: "settings",
};
const INVENTORY: DockPathStep = {
  id: "world:inventory",
  label: "Inventory",
  icon: "inventory",
};

function path(
  steps: readonly [DockPathStep, ...DockPathStep[]],
  info = "x0skai drives",
  onBack = vi.fn(),
) {
  return (
    <DockPath
      steps={steps}
      info={info}
      fact="Lv 3"
      label="Dock path"
      backLabel={(place) => `Back to ${place}`}
      onBack={onBack}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DockPath", () => {
  it("always shows the Dock itself, as the open window when nothing else is", () => {
    render(path([DOCK]));

    const nav = screen.getByRole("navigation", { name: "Dock path" });
    expect(nav).toHaveClass("weighted-block", "dock-path");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("x0skai drives")).toBeVisible();
    expect(screen.getByText("Lv 3")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens a step for each window and offers the one before as the way back", () => {
    const onBack = vi.fn();
    render(path([DOCK, SETTINGS], "Application", onBack));

    const current = screen.getAllByRole("listitem").at(-1);
    expect(current).toHaveTextContent("Settings");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Application")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to Dock" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("lets a closed window's step leave before it is gone, inert meanwhile", () => {
    vi.useFakeTimers();
    const { rerender } = render(path([DOCK, SETTINGS]));

    rerender(path([DOCK, INVENTORY]));

    const items = screen.getAllByRole("listitem", { hidden: true });
    expect(items.map((item) => item.textContent)).toEqual([
      "Dock",
      "›Settings",
      "›Inventory",
    ]);
    expect(items[1]).toHaveAttribute("data-presence", "exiting");
    expect(items[1]).toHaveAttribute("aria-hidden", "true");
    expect(items[1]).toHaveAttribute("inert");
    expect(items[2]).toHaveAttribute("aria-current", "page");

    act(() => {
      vi.advanceTimersByTime(BLOCK_EXIT_MS);
    });
    expect(
      screen
        .getAllByRole("listitem", { hidden: true })
        .map((item) => item.textContent),
    ).toEqual(["Dock", "›Inventory"]);
  });

  it("goes back to the Dock alone, never to nothing", () => {
    vi.useFakeTimers();
    const { rerender } = render(path([DOCK, SETTINGS]));

    rerender(path([DOCK]));
    act(() => {
      vi.advanceTimersByTime(BLOCK_EXIT_MS);
    });

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem")).toHaveTextContent("Dock");
  });
});
