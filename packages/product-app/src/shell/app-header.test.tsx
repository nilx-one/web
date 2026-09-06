// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import { AppHeader } from "./app-header";
import type { ShellSection } from "./routes";
import type { ShellPresentation } from "./shell-presentation";

interface HeaderOverrides {
  presentation?: ShellPresentation;
  section?: ShellSection;
  pubDress?: string;
  onNavigate?: (route: string) => void;
  onSignOut?: () => void;
}

function renderHeader(overrides: HeaderOverrides = {}) {
  const onSignOut = overrides.onSignOut ?? vi.fn();

  return render(
    <AppHeader
      presentation={overrides.presentation ?? "wide"}
      hostLabel="browser host"
      section={overrides.section ?? "world"}
      pubDress={overrides.pubDress ?? "0x0sky"}
      actions={[{ id: "sign-out", label: "Sign out", perform: onSignOut }]}
      onNavigate={overrides.onNavigate ?? (() => undefined)}
    />,
  );
}

describe("AppHeader", () => {
  it("makes route semantics explicit on a wide viewport", () => {
    renderHeader({ presentation: "wide" });

    expect(screen.getByRole("link", { name: "/identity" })).toHaveAttribute(
      "href",
      "/identity",
    );
    expect(screen.getByRole("link", { name: "/settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("link", { name: "0x0sky" })).toBeNull();
    expect(screen.getByText("browser host")).toBeVisible();
  });

  it("carries the pub_dress and a settings gear at regular width", () => {
    renderHeader({ presentation: "regular" });

    expect(screen.getByRole("link", { name: "0x0sky" })).toHaveAttribute(
      "href",
      "/identity",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(screen.queryByRole("link", { name: "/identity" })).toBeNull();
  });

  it("moves settings into the overflow rather than crowding a narrow header", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    renderHeader({ presentation: "compact", onNavigate });

    expect(screen.getByRole("link", { name: "0x0sky" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Settings" }));

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/settings");
  });

  it("marks the presented route as the current page", () => {
    renderHeader({ presentation: "wide", section: "settings" });

    expect(screen.getByRole("link", { name: "/settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "/identity" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("routes a plain activation in the client and leaves a modified one to the browser", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    renderHeader({ presentation: "wide", onNavigate });

    await user.click(screen.getByRole("link", { name: "/identity" }));
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("/identity");

    onNavigate.mockClear();
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("link", { name: "/settings" }));
    await user.keyboard("{/Meta}");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("opens the overflow to the first item and closes it on Escape", async () => {
    const user = userEvent.setup();

    renderHeader({ presentation: "wide" });
    const trigger = screen.getByRole("button", { name: "More" });

    await user.click(trigger);
    const menu = screen.getByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(menu).getByRole("menuitem", { name: "Sign out" }),
    ).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("performs a host action from the overflow", async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();

    renderHeader({ presentation: "wide", onSignOut });

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps every presentation mode accessible", async () => {
    for (const presentation of ["compact", "regular", "wide"] as const) {
      const { container, unmount } = renderHeader({ presentation });
      const results = await axe.run(container);

      expect(results.violations, presentation).toEqual([]);
      unmount();
    }
  });
});
