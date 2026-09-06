// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { StatusToastStack, type StatusToastItem } from "./status-toast";

const statuses: readonly StatusToastItem[] = [
  {
    id: "active",
    kind: "active",
    title: "Shared core ready",
    description: "contract 0.1.0",
  },
  {
    id: "loading",
    kind: "loading",
    title: "Loading map",
    description: "Loading the self-hosted 0x1 map style.",
  },
  {
    id: "warning",
    kind: "warning",
    title: "Render latency high",
    description: "Frame delivery is slower than the local presentation target.",
  },
  {
    id: "error",
    kind: "error",
    title: "Backend unavailable",
    description: "The browser host could not reach the service endpoint.",
  },
];

describe("StatusToastStack", () => {
  it("shows the bounded newest tail in LIFO presentation order", () => {
    render(
      <StatusToastStack
        toasts={statuses}
        maxVisible={3}
        onDismiss={() => undefined}
      />,
    );

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");

    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Backend unavailable");
    expect(items[1]).toHaveTextContent("Render latency high");
    expect(items[2]).toHaveTextContent("Loading map");
    expect(screen.queryByText("Shared core ready")).toBeNull();
  });

  it("never offers dismissal for loading but dismisses other kinds", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <StatusToastStack toasts={statuses.slice(0, 2)} onDismiss={onDismiss} />,
    );

    expect(
      screen.queryByRole("button", { name: "Dismiss: Loading map" }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Dismiss: Shared core ready" }),
    );
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("active");
  });

  it("expands long descriptions through a read-more affordance", async () => {
    const user = userEvent.setup();
    const description =
      "This deliberately long notification description carries enough detail to exceed the compact two-line status surface and needs an explicit expansion control.";

    render(
      <StatusToastStack
        toasts={[
          {
            id: "long-warning",
            kind: "warning",
            title: "Performance warning",
            description,
          },
        ]}
        onDismiss={() => undefined}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Read more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Read less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps all four status kinds accessible", async () => {
    const { container } = render(
      <StatusToastStack
        toasts={statuses}
        maxVisible={4}
        onDismiss={() => undefined}
      />,
    );

    for (const status of statuses) {
      expect(
        container.querySelector(`[data-status-toast-kind="${status.kind}"]`),
      ).not.toBeNull();
    }

    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});
