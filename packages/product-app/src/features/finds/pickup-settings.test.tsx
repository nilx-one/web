// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PickupSettings } from "./pickup-settings";
import { choosePickup, readPickup } from "./pickup-preference";
import { chooseLocale } from "../../shell/localization";

afterEach(() => {
  window.localStorage.clear();
  chooseLocale("auto");
});

describe("PickupSettings slider", () => {
  it("defaults to the rightmost available rarity, with Off after it", () => {
    chooseLocale("en");
    render(<PickupSettings onExclusive={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    expect(slider).toHaveValue("4");
    expect(slider).toHaveAttribute("aria-valuetext", "common");
    expect(readPickup()).toBe("common,uncommon,rare,legendary");
    expect(
      Array.from(
        document.querySelectorAll(".interface-settings__slider-stops > span"),
        (label) => label.textContent,
      ),
    ).toEqual(["legendary", "special", "rare", "uncommon", "common", "Off"]);
  });

  it("keeps Core's thresholds and can disable pickup at the rightmost stop", () => {
    chooseLocale("en");
    render(<PickupSettings onExclusive={vi.fn()} />);
    const slider = screen.getByRole("slider", { name: "Pick up" });
    fireEvent.change(slider, { target: { value: "3" } });
    expect(readPickup()).toBe("uncommon,rare,legendary");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(readPickup()).toBe("rare,legendary");
    fireEvent.change(slider, { target: { value: "5" } });
    expect(readPickup()).toBe("");
    expect(slider).toHaveAttribute("aria-valuetext", "Off");
  });

  it.each(["0", "1"])(
    "requests the exclusive scene for stop %s without persisting a locked selection",
    (value) => {
      chooseLocale("en");
      const onExclusive = vi.fn();
      render(<PickupSettings onExclusive={onExclusive} />);
      const slider = screen.getByRole("slider", { name: "Pick up" });
      fireEvent.change(slider, { target: { value } });
      expect(onExclusive).toHaveBeenCalledOnce();
      expect(readPickup()).toBe("common,uncommon,rare,legendary");
      expect(slider).toHaveValue("4");
    },
  );

  it("preserves legacy custom sets, including when an exclusive stop is requested", () => {
    chooseLocale("en");
    choosePickup("uncommon", false);
    const original = readPickup();
    render(<PickupSettings onExclusive={vi.fn()} />);
    expect(screen.getByText("Custom selection")).toBeVisible();
    const slider = screen.getByRole("slider", { name: "Pick up" });
    fireEvent.change(slider, { target: { value: "0" } });
    expect(readPickup()).toBe(original);
    fireEvent.change(slider, { target: { value: "3" } });
    expect(readPickup()).toBe("uncommon,rare,legendary");
    expect(screen.queryByText("Custom selection")).not.toBeInTheDocument();
  });
});
