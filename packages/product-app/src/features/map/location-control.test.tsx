// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { observation } from "../../../../../tests/support/doubles";
import { chooseLocale } from "../../shell/localization";
import { LocationControl } from "./location-control";
import { createLocationControlViewModel } from "./location-control-view-model";

afterEach(() => {
  chooseLocale("auto");
  window.localStorage.clear();
});

describe("LocationControl localization", () => {
  it("rerenders active location copy when the local UI language changes", () => {
    chooseLocale("en");
    const viewModel = createLocationControlViewModel(
      { kind: "active", position: observation({ accuracyMeters: 18.4 }) },
      true,
    );

    render(<LocationControl viewModel={viewModel} onActivate={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Map centred on this device" }),
    ).toBeVisible();
    expect(screen.getByText("Accuracy about 18 m.")).toBeInTheDocument();

    act(() => chooseLocale("uk-UA"));

    expect(
      screen.getByRole("button", { name: "Мапа центрована на цьому пристрої" }),
    ).toBeVisible();
    expect(screen.getByText("Точність близько 18 m.")).toBeInTheDocument();
  });

  it("shows Core Bond–Avaia distance while keeping the location action", () => {
    chooseLocale("en");
    const onActivate = vi.fn();
    const viewModel = createLocationControlViewModel(
      { kind: "active", position: observation({ accuracyMeters: 12 }) },
      false,
    );
    const { container, rerender } = render(
      <LocationControl
        viewModel={viewModel}
        onActivate={onActivate}
        proximity={{
          distance_m: 15,
          red_m: 5000,
          restore_below_m: 4500,
          level: "near",
          can_reveal: true,
          duration_ms: 60_000,
        }}
      />,
    );
    expect(container.querySelector("[data-proximity='near']")).not.toBeNull();
    expect(screen.getByText("15m")).toBeVisible();
    screen.getByRole("button", { name: "Recenter map on this device" }).click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    rerender(
      <LocationControl
        viewModel={viewModel}
        onActivate={onActivate}
        proximity={{
          distance_m: 5000,
          red_m: 5000,
          restore_below_m: 4500,
          level: "red",
          can_reveal: false,
          duration_ms: null,
        }}
      />,
    );
    expect(container.querySelector("[data-proximity='red']")).not.toBeNull();
    expect(screen.getByText("5.0km")).toBeVisible();
  });

  it("localizes non-active accessibility copy too", () => {
    chooseLocale("uk-UA");
    const viewModel = createLocationControlViewModel(
      { kind: "permission-required" },
      false,
    );

    render(<LocationControl viewModel={viewModel} onActivate={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "Увімкнути геолокацію" }),
    ).toBeVisible();
    expect(
      screen.getByText("Показати цей пристрій на мапі."),
    ).toBeInTheDocument();
  });
});
