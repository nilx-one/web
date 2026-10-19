// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AuthForm,
  AuthView,
  DEFAULT_AUTH_SELECTION,
  type AuthFormState,
} from "./index";

const handlers = () => ({
  onCredentialAutofill: vi.fn(),
  onForgetRemembered: vi.fn(),
  onPasswordChange: vi.fn(),
  onResolveUsername: vi.fn(),
  onSelectionChange: vi.fn(),
  onSubmit: vi.fn(),
});
const available: AuthFormState = {
  mode: "register",
  status: { kind: "available", detail: "This name is available" },
  busy: false,
};

describe("shared contextual authentication", () => {
  it.each(["Prism", "h_ua_bot"])(
    "uses neutral content for %s",
    (productName) => {
      const actions = handlers();
      const { container } = render(
        <AuthView
          productName={productName}
          selection={DEFAULT_AUTH_SELECTION}
          identity={{
            mode: "initial",
            status: { kind: "idle", detail: "2–32 characters; case-sensitive" },
            busy: false,
          }}
          password=""
          {...actions}
        />,
      );
      expect(screen.getByRole("combobox", { name: "Prefix" })).toHaveValue("0");
      expect(screen.getByLabelText("Username")).toHaveValue("");
      expect(container.textContent).not.toMatch(
        /pub_dress|Bond|Avaia|xPing|recovery/i,
      );
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "f" },
      });
      expect(actions.onSelectionChange).toHaveBeenLastCalledWith({
        discriminator: "f",
        slug: "",
      });
      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "alice" },
      });
      expect(actions.onSelectionChange).toHaveBeenLastCalledWith({
        discriminator: "0",
        slug: "alice",
      });
    },
  );

  it("waits for explicit submission and blocks it while resolution is stale or busy", async () => {
    const actions = handlers();
    const props = {
      selection: { discriminator: "0", slug: "Sky" },
      password: "a valid password",
      ...actions,
    };
    const { rerender, container } = render(
      <AuthForm {...props} identity={available} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with 0x0Sky" }),
    );
    const create = await screen.findByRole(
      "button",
      { name: "Create account" },
      { timeout: 2000 },
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(actions.onSubmit).not.toHaveBeenCalled();
    rerender(
      <AuthForm
        {...props}
        identity={{
          ...available,
          status: { kind: "checking", detail: "Checking…" },
        }}
      />,
    );
    fireEvent.submit(container.querySelector("form")!);
    expect(actions.onSubmit).not.toHaveBeenCalled();
    rerender(<AuthForm {...props} identity={{ ...available, busy: true }} />);
    fireEvent.submit(container.querySelector("form")!);
    expect(actions.onSubmit).not.toHaveBeenCalled();
    rerender(<AuthForm {...props} identity={available} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create account" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(actions.onSubmit).toHaveBeenCalledOnce();
    expect(create).toHaveAttribute("type", "submit");
  });

  it("supports remembered sign-in in Ukrainian without treating a hint as a session", () => {
    const actions = handlers();
    render(
      <AuthView
        productName="Prism"
        locale="uk"
        selection={DEFAULT_AUTH_SELECTION}
        password=""
        identity={{
          mode: "remembered",
          rememberedUsername: "0xaSky",
          status: { kind: "registered", detail: "Введіть пароль" },
          busy: false,
        }}
        {...actions}
      />,
    );
    expect(screen.getByLabelText("Ім’я користувача")).toHaveValue("0xaSky");
    expect(screen.getByLabelText("Пароль")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByRole("button", { name: "Увійти" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Це не ви?" }));
    expect(actions.onForgetRemembered).toHaveBeenCalledOnce();
    expect(actions.onSubmit).not.toHaveBeenCalled();
  });
});
