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
  it("offers explicit confirmation after automatic address resolution", () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with 0x0sky" }),
    );
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

  it("keeps resolved pub_dress stable and submits after password-manager autofill", () => {
    const onPasswordChange = vi.fn();
    const onSelectionChange = vi.fn();
    const onSubmit = vi.fn();
    const selection = { discriminator: "f", slug: "rSb2" };
    const viewModel = {
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
        mode: "sign-in" as const,
        status: {
          kind: "registered" as const,
          detail: "Bond found — sign in" as const,
        },
        busy: false,
      },
    };
    const sharedProps = {
      selection,
      viewModel,
      onAcknowledgeRecovery: vi.fn(),
      onForgetRemembered: vi.fn(),
      onLogout: vi.fn(),
      onPasswordChange,
      onResolvePubDress: vi.fn(),
      onSelectionChange,
      onSubmit,
    };
    const { container, rerender } = render(
      <IdentityFoundationView {...sharedProps} password="" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with 0xfrSb2" }),
    );

    const slug = screen.getByRole("textbox", { name: "pub_dress" });
    const password = screen.getByLabelText("Password");
    const credentialUsername = container.querySelector<HTMLInputElement>(
      'input[name="username"]',
    );

    expect(slug).toHaveValue("rSb2");
    expect(slug).toHaveAttribute("autocomplete", "off");
    expect(credentialUsername).not.toBeNull();
    expect(credentialUsername).toHaveValue("0xfrSb2");

    fireEvent.input(slug, {
      target: { value: "0x0frSb" },
      inputType: "insertReplacementText",
    });
    expect(slug).toHaveValue("rSb2");
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.input(credentialUsername!, {
      target: { value: "0x0frSb" },
    });
    fireEvent.change(password, { target: { value: "stored-secret" } });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onPasswordChange).toHaveBeenCalledWith("stored-secret");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(slug).toHaveValue("rSb2");

    rerender(
      <IdentityFoundationView {...sharedProps} password="stored-secret" />,
    );

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(slug).toHaveValue("rSb2");
  });

  it("does not auto-submit a manually typed sign-in password", () => {
    const onPasswordChange = vi.fn();
    const onSubmit = vi.fn();
    const selection = { discriminator: "f", slug: "rSb2" };
    const viewModel = {
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
        mode: "sign-in" as const,
        status: {
          kind: "registered" as const,
          detail: "Bond found — sign in" as const,
        },
        busy: false,
      },
    };
    const sharedProps = {
      selection,
      viewModel,
      onAcknowledgeRecovery: vi.fn(),
      onForgetRemembered: vi.fn(),
      onLogout: vi.fn(),
      onPasswordChange,
      onResolvePubDress: vi.fn(),
      onSelectionChange: vi.fn(),
      onSubmit,
    };
    const { rerender } = render(
      <IdentityFoundationView {...sharedProps} password="" />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with 0xfrSb2" }),
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "typed-secret" },
    });
    rerender(
      <IdentityFoundationView {...sharedProps} password="typed-secret" />,
    );

    expect(onPasswordChange).toHaveBeenCalledWith("typed-secret");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps explicit password validation stable and counts whitespace", () => {
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

    const { rerender } = render(
      <IdentityFoundationView {...sharedProps} password="short" />,
    );
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

    rerender(
      <IdentityFoundationView {...sharedProps} password={" ".repeat(8)} />,
    );
    expect(password).toHaveValue(" ".repeat(8));
    expect(password.parentElement).toHaveAttribute("data-validation", "valid");
    expect(screen.getByRole("button", { name: "Create 0x0sky" })).toBeEnabled();
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
