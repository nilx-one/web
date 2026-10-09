// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PickupSettings } from "./pickup-settings";
import { choosePickup, readPickup } from "./pickup-preference";
import { chooseLocale } from "../../shell/localization";

afterEach(() => {
  window.localStorage.clear();
  chooseLocale("auto");
});

describe("PickupSettings slider", () => {
  it("starts at the far-right common stop with all four rarity groups", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    expect(slider).toHaveValue("4");
    expect(slider).toHaveAttribute("aria-valuetext", "1–3 · common");
    expect(readPickup()).toBe("common,uncommon,rare,legendary");
  });

  it("selects progressively rarer finds and can disable pickup entirely", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    fireEvent.change(slider, { target: { value: "3" } });
    expect(readPickup()).toBe("uncommon,rare,legendary");
    expect(slider).toHaveAttribute("aria-valuetext", "4 · uncommon");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(readPickup()).toBe("");
    expect(slider).toHaveAttribute("aria-valuetext", "Off");
  });

  it("does not overwrite older custom checkbox selections until moved", () => {
    chooseLocale("en");
    choosePickup("uncommon", false);
    const original = readPickup();
    render(<PickupSettings />);
    expect(screen.getByText("Custom selection")).toBeVisible();
    expect(readPickup()).toBe(original);
    fireEvent.change(screen.getByRole("slider", { name: "Pick up" }), {
      target: { value: "1" },
    });
    expect(readPickup()).toBe("legendary");
    expect(screen.queryByText("Custom selection")).not.toBeInTheDocument();
  });
});
