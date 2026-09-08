// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOCK_WINDOW_TRANSITION_MS, DockWindow } from "./dock-window";

/**
 * jsdom lays nothing out, so a window here has no two heights to travel
 * between. Giving the boxes a measurable height is what puts the component in
 * the state a painted browser puts it in.
 */
function layOutBoxes(height = 240): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => height,
  });
  return () => {
    if (descriptor === undefined) {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
      return;
    }
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", descriptor);
  };
}

function windowElement(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".bond-dock__window");
  if (element === null) throw new Error("the Dock window is missing");
  return element;
}

describe("Dock window", () => {
  const restorers: (() => void)[] = [];

  afterEach(() => {
    while (restorers.length > 0) restorers.pop()?.();
  });

  function measured(height?: number): void {
    restorers.push(layOutBoxes(height));
  }

  it("presents one settled screen when nothing has moved", () => {
    const { container } = render(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    const screens = container.querySelectorAll(".bond-dock__screen");
    expect(screens).toHaveLength(1);
    expect(screens[0]).toHaveAttribute("data-phase", "settled");
    expect(windowElement(container)).not.toHaveAttribute("data-navigation");
  });

  it("holds both screens while a deeper one arrives", () => {
    measured();
    const { container, rerender } = render(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    rerender(
      <DockWindow screen="identity" depth={1}>
        <p>Bond</p>
      </DockWindow>,
    );

    expect(windowElement(container)).toHaveAttribute("data-navigation", "push");
    const [leaving, arriving] =
      container.querySelectorAll<HTMLElement>(".bond-dock__screen");
    expect(leaving).toHaveAttribute("data-phase", "from");
    expect(leaving).toHaveTextContent("World");
    // The screen being left is out of reach for a pointer and for assistance.
    expect(leaving).toHaveAttribute("aria-hidden", "true");
    expect(leaving?.hasAttribute("inert")).toBe(true);
    expect(arriving).toHaveAttribute("data-phase", "to");
    expect(arriving).toHaveTextContent("Bond");
  });

  it("reverses the move when a shallower screen comes back", () => {
    measured();
    const { container, rerender } = render(
      <DockWindow screen="identity" depth={1}>
        <p>Bond</p>
      </DockWindow>,
    );

    rerender(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    expect(windowElement(container)).toHaveAttribute("data-navigation", "pop");
  });

  it("travels between the two heights and then lets the window breathe", () => {
    vi.useFakeTimers();
    restorers.push(() => vi.useRealTimers());
    measured(320);
    const { container, rerender } = render(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    rerender(
      <DockWindow screen="identity" depth={1}>
        <p>Bond</p>
      </DockWindow>,
    );

    expect(windowElement(container).style.height).toBe("320px");

    act(() => {
      vi.advanceTimersByTime(DOCK_WINDOW_TRANSITION_MS);
    });

    const settled = windowElement(container);
    expect(settled).not.toHaveAttribute("data-navigation");
    expect(settled.style.height).toBe("");
    expect(container.querySelectorAll(".bond-dock__screen")).toHaveLength(1);
    expect(screen.queryByText("World")).not.toBeInTheDocument();
  });

  it("arrives settled where there is no layout to travel through", () => {
    const { container, rerender } = render(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    rerender(
      <DockWindow screen="identity" depth={1}>
        <p>Bond</p>
      </DockWindow>,
    );

    expect(windowElement(container)).not.toHaveAttribute("data-navigation");
    expect(container.querySelectorAll(".bond-dock__screen")).toHaveLength(1);
  });

  it("keeps the destination when a person asks for less motion", () => {
    measured();
    // jsdom carries no media queries of its own, so the preference is stated.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    restorers.push(() => {
      window.matchMedia = original;
    });

    const { container, rerender } = render(
      <DockWindow screen="home" depth={0}>
        <p>World</p>
      </DockWindow>,
    );

    rerender(
      <DockWindow screen="identity" depth={1}>
        <p>Bond</p>
      </DockWindow>,
    );

    expect(windowElement(container)).not.toHaveAttribute("data-navigation");
    expect(screen.getByText("Bond")).toBeVisible();
  });
});
