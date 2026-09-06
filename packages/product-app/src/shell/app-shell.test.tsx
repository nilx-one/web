// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./app-shell";

function renderShell() {
  return render(
    <AppShell
      presentation="wide"
      safeArea={{ top: 44, right: 8, bottom: 34, left: 8 }}
      world={<div data-testid="world" />}
      header={<header data-testid="header" />}
      toasts={<div data-testid="toasts" />}
      dock={<section data-testid="dock" />}
      statusRail={<span data-testid="status" />}
      overlay={<span data-testid="overlay" />}
    />,
  );
}

function layerOrder(container: HTMLElement): string[] {
  const shell = container.querySelector(".app-shell");
  return [...(shell?.children ?? [])].map(
    (child) => child.className.split(" ")[0] ?? "",
  );
}

describe("AppShell", () => {
  it("stacks the world, the header, the toast stack and the Dock as separate layers", () => {
    const { container } = renderShell();

    expect(layerOrder(container)).toEqual([
      "app-shell__world",
      "app-shell__header",
      "app-shell__toasts",
      "app-shell__bottom",
      "app-shell__overlay",
    ]);
  });

  it("keeps the toast stack out of the Dock and the Dock out of the toast stack", () => {
    const { container, getByTestId } = renderShell();
    const bottom = container.querySelector(".app-shell__bottom");
    const toasts = container.querySelector(".app-shell__toasts");

    expect(bottom?.contains(getByTestId("dock"))).toBe(true);
    expect(bottom?.contains(getByTestId("toasts"))).toBe(false);
    expect(toasts?.contains(getByTestId("toasts"))).toBe(true);
    expect(toasts?.contains(getByTestId("dock"))).toBe(false);
  });

  it("puts the Dock last in the bottom layer so growth moves its upper edge", () => {
    const { container } = renderShell();
    const bottom = container.querySelector(".app-shell__bottom");
    const children = [...(bottom?.children ?? [])].map(
      (child) => child.className,
    );

    // The bottom layer is reversed in flow: the Dock is the first child and
    // stays visually attached to the bottom while the status rail rides above.
    expect(children).toEqual(["app-shell__dock", "app-shell__status"]);
  });

  it("publishes the host safe area to every layer", () => {
    const { container } = renderShell();
    const shell = container.querySelector<HTMLElement>(".app-shell");

    expect(shell?.style.getPropertyValue("--safe-top")).toBe("44px");
    expect(shell?.style.getPropertyValue("--safe-right")).toBe("8px");
    expect(shell?.style.getPropertyValue("--safe-bottom")).toBe("34px");
    expect(shell?.style.getPropertyValue("--safe-left")).toBe("8px");
    expect(shell).toHaveAttribute("data-presentation", "wide");
  });

  it("exposes the toast anchor even before a notice arrives", () => {
    const { container } = renderShell();

    expect(container.querySelector(".app-shell__notices")).not.toBeNull();
  });
});
