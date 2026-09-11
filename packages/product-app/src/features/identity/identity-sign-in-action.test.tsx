// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IdentityFoundationView } from "./identity-foundation-view";

describe("existing-Bond sign-in action", () => {
  it("stays visible and disabled until confirmation and valid auth input make submission ready", () => {
    const onPasswordChange = vi.fn();
    const onResolvePubDress = vi.fn();
    const onSubmit = vi.fn();
    const selection = { discriminator: "0", slug: "sky" };
    const viewModel = {
      hostLabel: "telegram host",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      showProviderRow: false,
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
      onCredentialAutofill: vi.fn(),
      onForgetRemembered: vi.fn(),
      onLogout: vi.fn(),
      onPasswordChange,
      onResolvePubDress,
      onSelectionChange: vi.fn(),
      onSubmit,
    };

    const view = render(
      <IdentityFoundationView {...sharedProps} password="" />,
    );

    const signIn = screen.getByRole("button", { name: "Sign in" });
    expect(signIn).toBeVisible();
    expect(signIn).toBeDisabled();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue with 0x0sky" }),
    );

    expect(onResolvePubDress).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Password")).toBeVisible();
    expect(screen.getByRole("button", { name: "Sign in" })).toBe(signIn);
    expect(signIn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "typed-secret" },
    });
    expect(onPasswordChange).toHaveBeenCalledWith("typed-secret");

    view.rerender(
      <IdentityFoundationView {...sharedProps} password="typed-secret" />,
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toBe(signIn);
    expect(signIn).toBeEnabled();

    fireEvent.click(signIn);
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
