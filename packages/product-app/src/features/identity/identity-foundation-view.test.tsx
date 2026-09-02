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
  it("keeps an automatically resolved address editable until keyboard confirmation", () => {
    vi.useFakeTimers();
    const onResolvePubDress = vi.fn();

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
        onResolvePubDress={onResolvePubDress}
        onSelectionChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.getByText("Available — create this identity")).toHaveClass(
      "visually-hidden",
    );

    act(() => vi.advanceTimersByTime(900));

    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit 0x0sky" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("pub_dress"), { key: "Enter" });
    expect(onResolvePubDress).toHaveBeenCalledOnce();
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

  it("uses the mobile go action to resolve and then focus password", () => {
    vi.useFakeTimers();
    const onResolvePubDress = vi.fn();
    const sharedProps = {
      password: "",
      selection: { discriminator: "0", slug: "sky" },
      onAcknowledgeRecovery: vi.fn(),
      onForgetRemembered: vi.fn(),
      onLogout: vi.fn(),
      onPasswordChange: vi.fn(),
      onResolvePubDress,
      onSelectionChange: vi.fn(),
      onSubmit: vi.fn(),
    };
    const viewModel = {
      hostLabel: "browser host",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      showProviderRow: true,
      runtime: {
        tone: "ready" as const,
        label: "Shared Core ready" as const,
        detail: "Contract 1 is available to the Web client.",
      },
    };
    const { rerender } = render(
      <IdentityFoundationView
        {...sharedProps}
        viewModel={{
          ...viewModel,
          identity: {
            kind: "form",
            mode: "initial",
            status: {
              kind: "idle",
              detail: "Case-sensitive · 2–32 characters",
            },
            busy: false,
          },
        }}
      />,
    );

    const slug = screen.getByLabelText("pub_dress");
    expect(slug).toHaveAttribute("enterkeyhint", "go");
    fireEvent.keyDown(slug, { key: "Enter" });
    expect(onResolvePubDress).toHaveBeenCalledOnce();

    rerender(
      <IdentityFoundationView
        {...sharedProps}
        viewModel={{
          ...viewModel,
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
      />,
    );
    act(() => vi.advanceTimersByTime(900));

    expect(screen.getByLabelText("Password")).toHaveFocus();
  });

  it("does not change explicit password validation when visibility changes", () => {
    vi.useFakeTimers();
    const sharedProps = {
      selection: { discriminator: "0", slug: "sky" },
      onAcknowledgeRecovery: vi.fn(),
      onForgetRemembered: vi.fn(),
      onLogout: vi.fn(),
      onPasswordChange: vi.fn(),
      onResolvePubDress: vi.fn(),
      onSelectionChange: vi.fn(),
      onSubmit: vi.fn(),
      viewModel: {
        hostLabel: "browser host",
        safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
        showProviderRow: true,
        runtime: {
          tone: "ready" as const,
          label: "Shared Core ready" as const,
          detail: "Contract 1 is available to the Web client.",
        },
        identity: {
          kind: "form" as const,
          mode: "register" as const,
          status: {
            kind: "available" as const,
            detail: "Available — create this identity" as const,
          },
          busy: false,
        },
      },
    };

    render(<IdentityFoundationView {...sharedProps} password="short" />);
    fireEvent.keyDown(screen.getByLabelText("pub_dress"), { key: "Enter" });
    act(() => vi.advanceTimersByTime(900));

    const password = screen.getByLabelText("Password");
    expect(password.parentElement).toHaveAttribute(
      "data-validation",
      "invalid",
    );
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password.parentElement).toHaveAttribute(
      "data-validation",
      "invalid",
    );
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
