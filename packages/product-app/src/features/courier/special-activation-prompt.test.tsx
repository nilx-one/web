// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SpecialActivationPrompt } from "./special-activation-prompt";

const props = {
  locale: "uk-UA" as const,
  canSkip: true,
  busy: false,
};

it("asks whether to activate, and lets a subscribed Bond skip", () => {
  const onActivate = vi.fn();
  const onSkip = vi.fn();
  render(
    <SpecialActivationPrompt
      {...props}
      onActivate={onActivate}
      onSkip={onSkip}
    />,
  );
  expect(screen.getByText("Активувати зараз?")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Пропустити" }));
  expect(onSkip).toHaveBeenCalledOnce();
  expect(onActivate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Так" }));
  expect(onActivate).toHaveBeenCalledOnce();
});

it("offers no skip without an active subscription", () => {
  render(
    <SpecialActivationPrompt
      {...props}
      locale="en"
      canSkip={false}
      onActivate={() => {}}
      onSkip={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Yes" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(screen.getByText(/has to be activated right away/)).toBeVisible();
});

it("disables both answers while activating", () => {
  render(
    <SpecialActivationPrompt
      {...props}
      locale="en"
      busy
      onActivate={() => {}}
      onSkip={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "Activating…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
});
