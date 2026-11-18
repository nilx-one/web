// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseLocale } from "../../shell/localization";
import { AisMigrationScreen } from "./ais-migration-screen";

afterEach(() => {
  chooseLocale("auto");
  window.localStorage.clear();
});

const base = {
  hostLabel: "browser host",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  busy: false,
  onConfirm: vi.fn(),
  onBack: vi.fn(),
};

describe("moving a Bond to aiaiaiai", () => {
  it("changes nothing until the owner confirms, and can be left", () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    render(
      <AisMigrationScreen
        {...base}
        stage="confirm"
        onConfirm={onConfirm}
        onBack={onBack}
      />,
    );
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Move this Bond to aiaiaiai" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("disables both actions while working", () => {
    render(<AisMigrationScreen {...base} stage="confirm" busy />);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
    }
  });

  it("says why a step failed, in the person's language, with no confirm action", () => {
    chooseLocale("uk-UA");
    render(
      <AisMigrationScreen {...base} stage="error" reason="identity-conflict" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("уже має профіль 0x1");
    expect(
      screen.queryByRole("button", { name: /aiaiaiai/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Назад" })).toBeVisible();
  });
});
