// © 2026 aiaiaiai · aiaiaiai.org
// SPDX-License-Identifier: MPL-2.0

import type { CoreRuntimePort } from "@nilx-one/application";
import type { HostPort } from "@nilx-one/host-contract";
import { ProductApp } from "@nilx-one/product-app";
import { act, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

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

describe("ProductApp", () => {
  it("renders the same honest Core boundary through the shared product", async () => {
    const core: CoreRuntimePort = {
      probe: async () => ({
        kind: "unavailable",
        reason: "artifact-missing",
      }),
    };

    render(<ProductApp core={core} host={createHost()} />);

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
      <ProductApp core={core} host={createHost()} />,
    );
    await screen.findByText("Shared Core required");

    const results = await act(() => axe.run(container));
    expect(results.violations).toEqual([]);
  });
});
