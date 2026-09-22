// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "./primitives";

describe("ProgressBar", () => {
  it("reads the ratio as a percentage a screen reader can announce", () => {
    render(<ProgressBar ratio={0.42} label="Downloading" />);

    const bar = screen.getByRole("progressbar", { name: "Downloading" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(screen.getByText("Downloading — 42%")).toBeVisible();
  });

  it("clamps a ratio outside 0–1 rather than rendering it as given", () => {
    render(<ProgressBar ratio={1.4} label="Downloading" />);
    expect(
      screen.getByRole("progressbar", { name: "Downloading" }),
    ).toHaveAttribute("aria-valuenow", "100");

    render(<ProgressBar ratio={-0.2} label="Loading" />);
    expect(
      screen.getByRole("progressbar", { name: "Loading" }),
    ).toHaveAttribute("aria-valuenow", "0");
  });
});
