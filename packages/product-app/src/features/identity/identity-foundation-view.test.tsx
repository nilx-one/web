// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IdentityFoundationView,
  calculateFieldReflection,
} from "./identity-foundation-view";

afterEach(() => {
  vi.useRealTimers();
});

describe("progressive native identity form", () => {
  it("pulses availability before collapsing the address and focusing password", () => {
    vi.useFakeTimers();

    render(
      <IdentityFoundationView
        password=""
        selection={{ discriminator: "0", slug: "sky" }}
        viewModel={{
          hostLabel: "browser host",
          safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
          showProviderRow: true,
          runtime: {
            tone: "ready",
            label: "Shared Core ready",
            detail: "Contract 1 is available to the Web client.",
          },
          identity: {
            kind: "form",
            mode: "register",
            status: {
              kind: "available",
              detail: "Available — create this identity",
            },
            busy: false,
          },
        }}
        onAcknowledgeRecovery={vi.fn()}
        onForgetRemembered={vi.fn()}
        onLogout={vi.fn()}
        onPasswordChange={vi.fn()}
        onSelectionChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByText("Available — create this identity")).toHaveClass(
      "visually-hidden",
    );

    act(() => vi.advanceTimersByTime(900));

    const password = screen.getByLabelText("Password");
    expect(screen.getByRole("button", { name: "Edit 0x0sky" })).toBeVisible();
    expect(password).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Edit 0x0sky" }));

    expect(
      screen.getByLabelText("pub_dress hexadecimal discriminator"),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "pub_dress" })).toHaveFocus();
  });

  it("attenuates reflected light with distance and widens its footprint", () => {
    const source = {
      top: 0,
      right: 300,
      bottom: 66,
      left: 0,
      width: 300,
      height: 66,
    };
    const receiver = {
      top: 82,
      right: 300,
      bottom: 148,
      left: 0,
      width: 300,
      height: 66,
    };

    const near = calculateFieldReflection(source, receiver);
    const far = calculateFieldReflection(source, {
      ...receiver,
      top: 210,
      bottom: 276,
    });

    expect(near.x).toBe(150);
    expect(near.energy).toBeGreaterThan(far.energy);
    expect(near.spread).toBeLessThan(far.spread);
  });
});
