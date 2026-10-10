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
    expect(slider).toHaveAttribute("aria-valuetext", "common");
    expect(readPickup()).toBe("common,uncommon,rare,legendary");
  });

  it("selects progressively rarer finds and can disable pickup entirely", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    fireEvent.change(slider, { target: { value: "3" } });
    expect(readPickup()).toBe("uncommon,rare,legendary");
    expect(slider).toHaveAttribute("aria-valuetext", "uncommon");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(readPickup()).toBe("");
    expect(slider).toHaveAttribute("aria-valuetext", "Off");
  });

  it("shows all six stops and a complete gradient at common", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    expect(slider).toHaveAttribute("max", "5");
    expect(slider).toHaveValue("5");
    expect(screen.getByText("special", { selector: "[data-pending]" })).toBeVisible();
    expect(screen.getByText(/Special finds are not supported/)).toBeVisible();
    const fill = document.querySelector(".interface-settings__pickup-spectrum-fill");
    expect(fill).toHaveStyle({ clipPath: "inset(0 0% 0 0 round 999px)" });

    fireEvent.change(slider, { target: { value: "3" } });
    expect(readPickup()).toBe("rare,legendary");
    expect(slider).toHaveValue("3");
    expect(fill).toHaveStyle({ clipPath: "inset(0 40% 0 0 round 999px)" });
  });

  it("skips special in either direction without changing Core's wire format", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const slider = screen.getByRole("slider", { name: "Pick up" });

    fireEvent.change(slider, { target: { value: "3" } });
    fireEvent.change(slider, { target: { value: "2" } });
    expect(readPickup()).toBe("legendary");
    expect(slider).toHaveValue("1");

    fireEvent.change(slider, { target: { value: "2" } });
    expect(readPickup()).toBe("rare,legendary");
    expect(slider).toHaveValue("3");
  });

  it("shows only short labels without tier numbers", () => {
    chooseLocale("en");
    render(<PickupSettings />);
    const labels = document.querySelectorAll(
      ".interface-settings__pickup-spectrum-stops span",
    );
    expect(Array.from(labels, (label) => label.textContent)).toEqual([
      "Off",
      "legendary",
      "special",
      "rare",
      "uncommon",
      "common",
    ]);
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
