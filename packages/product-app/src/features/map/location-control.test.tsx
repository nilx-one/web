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
