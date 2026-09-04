// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { Toast, ToastRegion, type ToastRegionItem } from "./toast";

const notice: ToastRegionItem = {
  id: "notice-1",
  tone: "neutral",
  title: "Declined by authority",
  description: "Authority was asked and the answer was no.",
};

describe("ToastRegion", () => {
  it("exposes a labelled polite live region before anything is announced", () => {
    const { container } = render(
      <ToastRegion toasts={[]} onDismiss={() => undefined} />,
    );

    const region = screen.getByRole("region", { name: "Notifications" });

    expect(region).toBeInTheDocument();
    expect(container.querySelector(".toast-region__list")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("announces a toast added to the standing live region", () => {
    const { container, rerender } = render(
      <ToastRegion toasts={[]} onDismiss={() => undefined} />,
    );
    const live = container.querySelector(".toast-region__list");

    rerender(<ToastRegion toasts={[notice]} onDismiss={() => undefined} />);

    expect(live).toBe(container.querySelector(".toast-region__list"));
    expect(live).toHaveTextContent("Declined by authority");
  });

  it("dismisses the toast a person chose, by keyboard", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <ToastRegion
        toasts={[notice, { ...notice, id: "notice-2", title: "Limit reached" }]}
        onDismiss={onDismiss}
      />,
    );

    await user.tab();
    await user.keyboard("{Enter}");

    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("notice-1");
  });

  it("keeps every toast reachable in the accessibility tree", async () => {
    const { container } = render(
      <ToastRegion
        toasts={[
          notice,
          {
            id: "notice-2",
            tone: "attention",
            title: "Request unanswered",
            description: "Nothing could answer this request.",
            details: "code inference_unavailable · operation op-71c",
            action: { label: "Try again", onPerform: () => undefined },
          },
        ]}
        onDismiss={() => undefined}
      />,
    );

    const results = await axe.run(container);

    expect(results.violations).toEqual([]);
  });
});

describe("Toast", () => {
  it("names the toast it dismisses so the control is unambiguous", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <Toast tone="neutral" title="Limit reached" onDismiss={onDismiss} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Dismiss: Limit reached" }),
    );

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("offers the action it was given and nothing else", async () => {
    const user = userEvent.setup();
    const onPerform = vi.fn();

    render(
      <Toast
        tone="attention"
        title="Request unanswered"
        action={{ label: "Try again", onPerform }}
        onDismiss={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onPerform).toHaveBeenCalledOnce();
  });

  it("keeps correlation handles behind a details affordance", () => {
    render(
      <Toast
        tone="critical"
        title="Request rejected"
        description="The request contradicted the contract."
        details="code contract_rejected · operation op-71c"
        onDismiss={() => undefined}
      />,
    );

    const disclosure = screen.getByText("Reference").closest("details");

    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");
    expect(disclosure).toHaveTextContent("op-71c");
  });

  it("renders no action affordance when none was offered", () => {
    render(
      <Toast
        tone="neutral"
        title="Declined by authority"
        onDismiss={() => undefined}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
