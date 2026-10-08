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

  describe("wearing the Bond–Avaia distance", () => {
    const policy = (
      distance_m: number,
      level: "near" | "working" | "restricted" | "red",
      can_reveal: boolean,
    ) => ({
      distance_m,
      red_m: 5000,
      restore_below_m: 4500,
      level,
      can_reveal,
      duration_ms: can_reveal ? 60_000 : null,
    });
    const viewModel = () =>
      createLocationControlViewModel(
        { kind: "active", position: observation({ accuracyMeters: 12 }) },
        false,
      );

    it("shows Core's distance while keeping the location action", () => {
      chooseLocale("en");
      const onActivate = vi.fn();
      const { container, rerender } = render(
        <LocationControl
          viewModel={viewModel()}
          onActivate={onActivate}
          proximity={policy(15, "working", true)}
        />,
      );
      expect(
        container.querySelector("[data-proximity='working']"),
      ).not.toBeNull();
      expect(container.querySelector("[data-reveal='open']")).not.toBeNull();
      expect(screen.getByText("15m")).toBeVisible();
      screen.getByRole("button", { name: "Recenter on this device" }).click();
      expect(onActivate).toHaveBeenCalledTimes(1);

      rerender(
        <LocationControl
          viewModel={viewModel()}
          onActivate={onActivate}
          proximity={policy(5000, "red", false)}
        />,
      );
      expect(container.querySelector("[data-proximity='red']")).not.toBeNull();
      expect(container.querySelector("[data-reveal='held']")).not.toBeNull();
      expect(screen.getByText("5.0km")).toBeVisible();
    });

    it("says in words whether fog work is open, held or waiting", () => {
      chooseLocale("en");
      const { rerender } = render(
        <LocationControl
          viewModel={viewModel()}
          onActivate={vi.fn()}
          proximity={policy(300, "working", true)}
        />,
      );
      expect(screen.getByText(/Avaia is 300m from you\./)).toBeInTheDocument();
      rerender(
        <LocationControl
          viewModel={viewModel()}
          onActivate={vi.fn()}
          proximity={policy(4700, "restricted", false)}
        />,
      );
      expect(
        screen.getByText(/Avaia is 4\.7km from you: too far to reveal fog/),
      ).toBeInTheDocument();
      rerender(
        <LocationControl
          viewModel={viewModel()}
          onActivate={vi.fn()}
          proximity="unknown"
        />,
      );
      expect(screen.getByText("?")).toBeVisible();
      expect(
        screen.getByText(/Where Avaia is isn't known yet, so fog work waits\./),
      ).toBeInTheDocument();
    });

    it("localizes the distance and the spoken state", () => {
      chooseLocale("uk-UA");
      const { rerender } = render(
        <LocationControl
          viewModel={viewModel()}
          onActivate={vi.fn()}
          proximity={policy(300, "working", true)}
        />,
      );
      expect(screen.getByText("300м")).toBeVisible();
      expect(screen.getByText(/Avaia за 300м від вас\./)).toBeInTheDocument();
      rerender(
        <LocationControl
          viewModel={viewModel()}
          onActivate={vi.fn()}
          proximity={policy(5200, "red", false)}
        />,
      );
      expect(screen.getByText("5.2км")).toBeVisible();
      expect(screen.getByText(/надто далеко/)).toBeInTheDocument();
    });

    it("keeps the plain glyph where the host has no proximity at all", () => {
      chooseLocale("en");
      const { container } = render(
        <LocationControl viewModel={viewModel()} onActivate={vi.fn()} />,
      );
      expect(
        container.querySelector(".location-control__glyph"),
      ).not.toBeNull();
      expect(container.querySelector("[data-proximity='none']")).not.toBeNull();
      expect(container.querySelector(".location-control__distance")).toBeNull();
    });
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
