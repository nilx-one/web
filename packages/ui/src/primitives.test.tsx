// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppChrome, ProgressBar } from "./primitives";

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

describe("AppChrome", () => {
  it("speaks its own chrome in the words a host passes", () => {
    render(
      <AppChrome
        copy={{
          skip: "Перейти до вмісту",
          home: "Головна 0x1",
          currentHost: "Поточний хост",
        }}
        footer={null}
        hostLabel="хост браузера"
        safeArea={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <p>content</p>
      </AppChrome>,
    );

    expect(screen.getByText("Перейти до вмісту")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Головна 0x1" })).toBeVisible();
    expect(
      screen.getByLabelText("Поточний хост: хост браузера"),
    ).toBeInTheDocument();
  });
});
