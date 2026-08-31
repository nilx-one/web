// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type {
  CoreRuntimePort,
  IdentityRegistrationPort,
} from "@nilx-one/application";
import type { HostPort } from "@nilx-one/host-contract";
import { ProductApp } from "@nilx-one/product-app";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

function createHost(): HostPort {
  return {
    getSnapshot: () => ({
      kind: "browser",
      available: true,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: { kind: "browser-session" },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
  };
}

function createTelegramHost(): HostPort {
  return {
    getSnapshot: () => ({
      kind: "telegram",
      available: true,
      theme: "light",
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      authentication: {
        kind: "telegram-init-data",
        initData: "signed-init-data",
        verification: "required",
      },
    }),
    subscribe: () => () => undefined,
    ready: vi.fn(),
    openExternal: vi.fn(),
    impact: vi.fn(),
  };
}

describe("ProductApp", () => {
  const identity: IdentityRegistrationPort = {
    read: async () => ({ kind: "authentication-required" }),
    register: async () => ({
      kind: "rejected",
      reason: "authentication-required",
    }),
  };

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders the same honest Core boundary through the shared product", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({
        kind: "unavailable",
        reason: "artifact-missing",
      }),
    };

    render(<ProductApp core={core} host={createHost()} identity={identity} />);

    expect(
      await screen.findByRole("heading", { name: "Identity is continuity." }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Shared Core required")).toBeInTheDocument();
    expect(
      screen.getByText(/will not invent its behavior in TypeScript/i),
    ).toBeInTheDocument();
  });

  it("has no automatically detectable accessibility violations", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({
        kind: "unavailable",
        reason: "artifact-missing",
      }),
    };

    const { container } = render(
      <ProductApp core={core} host={createHost()} identity={identity} />,
    );
    await screen.findByText("Shared Core required");

    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);
  });

  it("mounts Telegram registration under its production basepath without changing slug semantics", async () => {
    window.history.replaceState({}, "", "/telegram/");

    const user = userEvent.setup();
    const core: CoreRuntimePort = {
      probe: async () => ({ kind: "ready", contractVersion: "0.1.0" }),
    };
    const register = vi
      .fn<IdentityRegistrationPort["register"]>()
      .mockResolvedValue({
        kind: "registered",
        outcome: "created",
        identity: { pubDress: "0xaSky" },
      });
    const telegramIdentity: IdentityRegistrationPort = {
      read: async () => ({ kind: "not-registered" }),
      register,
    };

    render(
      <ProductApp
        core={core}
        host={createTelegramHost()}
        identity={telegramIdentity}
        routerBasepath="/telegram"
      />,
    );

    const discriminator = await screen.findByRole("combobox", {
      name: "pub_dress hexadecimal discriminator",
    });
    expect(discriminator).toHaveValue("0");
    expect(screen.getAllByRole("option")).toHaveLength(16);

    await user.selectOptions(discriminator, "a");
    await user.type(screen.getByLabelText("Choose your pub_dress"), "Sky");
    await user.click(
      screen.getByRole("button", { name: "Register pub_dress" }),
    );

    expect(register).toHaveBeenCalledWith({
      discriminator: "a",
      slug: "Sky",
    });
    expect(await screen.findByText("0xaSky")).toBeInTheDocument();
  });
});
